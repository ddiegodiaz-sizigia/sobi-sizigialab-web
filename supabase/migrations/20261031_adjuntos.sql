-- Archivos con registro de acceso: adjuntos en el Caso y el archivo de un examen para el profesional.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261026_examenes.sql y 20261029_caso_equipo.sql.
-- En vez de una Edge Function: una función revisa el permiso, registra el acceso y deja un permiso de 2 minutos
-- (file_grants) para ESE archivo y ESE usuario; la política de storage lo exige para firmar la URL (la URL dura 5 min).
-- Así nadie firma un archivo ajeno sin pasar por la función, y cada apertura del profesional queda en access_log.
--   * Caso: bucket privado 'caso', ruta <patient_id>/<auth.uid()>/<aleatorio>.<ext>. Nadie lo lee directo (tampoco
--     admin ni la persona): solo open_case_file(), con las mismas reglas que el mensaje (retirado = sin archivo).
--   * Exámenes: open_document_file() para un profesional con permiso 'examenes' (la persona y el admin ya leen directo).

-- 1) Permisos de un solo archivo, por 2 minutos. RLS sin políticas: solo las funciones.
create table if not exists public.file_grants (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  bucket text not null,
  path text not null,
  expires_at timestamptz not null
);
create index if not exists file_grants_lookup_idx on public.file_grants (user_id, bucket, path);
alter table public.file_grants enable row level security;

create or replace function public.file_granted(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.file_grants g where g.user_id = auth.uid() and g.bucket = p_bucket and g.path = p_path and g.expires_at > now())
$$;
revoke all on function public.file_granted(text, text) from public, anon;
grant execute on function public.file_granted(text, text) to authenticated;

create or replace function public.grant_file(p_bucket text, p_path text) returns void
language sql security definer set search_path = public as $$
  delete from public.file_grants where expires_at < now() - interval '1 day';
  insert into public.file_grants (user_id, bucket, path, expires_at) values (auth.uid(), p_bucket, p_path, now() + interval '2 minutes');
$$;
revoke all on function public.grant_file(text, text) from public, anon, authenticated;

-- 2) Bucket del Caso. 10 MB, PDF e imágenes (igual que 'documentos').
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('caso', 'caso', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Quién sube al caso de esta persona? Ella misma o un profesional con 'equipo' activo.
create or replace function public.case_can_upload(p_patient text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_patient = public.current_patient_id()::text
      or exists (select 1 from public.care_links l where l.professional_id = public.current_professional_id() and l.patient_id::text = p_patient
                 and l.revoked_at is null and 'equipo' = any (l.scopes))
$$;
revoke all on function public.case_can_upload(text) from public, anon;
grant execute on function public.case_can_upload(text) to authenticated;

-- 3) Adjuntos. Editar copia los adjuntos a la versión nueva (misma ruta). Nada se borra.
create table if not exists public.case_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.case_messages(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  storage_path text not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create index if not exists case_attachments_msg_idx on public.case_attachments (message_id);
create index if not exists case_attachments_path_idx on public.case_attachments (storage_path);
alter table public.case_attachments enable row level security;

-- Un archivo subido que todavía no está en un mensaje (si el envío falla, quien lo subió lo borra).
create or replace function public.case_file_unattached(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.case_attachments a where a.storage_path = p_path)
$$;
revoke all on function public.case_file_unattached(text) from public, anon;
grant execute on function public.case_file_unattached(text) to authenticated;

-- 4) Storage: subir a la carpeta propia; borrar solo lo propio sin enviar; leer solo con permiso vigente.
drop policy if exists caso_insert on storage.objects;
create policy caso_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'caso' and (storage.foldername(name))[2] = auth.uid()::text and public.case_can_upload((storage.foldername(name))[1]));
drop policy if exists caso_delete_unsent on storage.objects;
create policy caso_delete_unsent on storage.objects for delete to authenticated
  using (bucket_id = 'caso' and (storage.foldername(name))[2] = auth.uid()::text and public.case_file_unattached(name));
drop policy if exists caso_granted_select on storage.objects;
create policy caso_granted_select on storage.objects for select to authenticated
  using (bucket_id = 'caso' and public.file_granted('caso', name));
drop policy if exists documentos_granted_select on storage.objects;
create policy documentos_granted_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and public.file_granted('documentos', name));

-- 5) Enviar con adjuntos: el mismo post_case_message y los archivos en la misma transacción.
-- p_files: [{path, file_name, mime_type, size_bytes}], máximo 5, subidos por quien envía a la carpeta de la persona.
create or replace function public.post_case_message_files(p_patient uuid, p_thread uuid, p_title text, p_topic text, p_ref_kind text, p_ref_id uuid,
  p_body text, p_audience text, p_to uuid[], p_with_patient boolean, p_mentions uuid[], p_journal_kind text, p_files jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; f jsonb; v_path text;
begin
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 5 then raise exception 'maximo 5 archivos'; end if;
  v_id := public.post_case_message(p_patient, p_thread, p_title, p_topic, p_ref_kind, p_ref_id, p_body, p_audience, p_to, p_with_patient, p_mentions, p_journal_kind);
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    v_path := f->>'path';
    if v_path is null or split_part(v_path, '/', 1) <> p_patient::text or split_part(v_path, '/', 2) <> auth.uid()::text then raise exception 'ruta de archivo invalida'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'caso' and o.name = v_path) then raise exception 'archivo no encontrado'; end if;
    if exists (select 1 from public.case_attachments a where a.storage_path = v_path) then raise exception 'archivo ya adjunto'; end if;
    insert into public.case_attachments (message_id, patient_id, storage_path, file_name, mime_type, size_bytes)
      values (v_id, p_patient, v_path, left(btrim(coalesce(f->>'file_name', 'archivo')), 200), coalesce(f->>'mime_type', 'application/octet-stream'), (f->>'size_bytes')::int);
  end loop;
  return v_id;
end $$;
revoke all on function public.post_case_message_files(uuid, uuid, text, text, text, uuid, text, text, uuid[], boolean, uuid[], text, jsonb) from public, anon;
grant execute on function public.post_case_message_files(uuid, uuid, text, text, text, uuid, text, text, uuid[], boolean, uuid[], text, jsonb) to authenticated;

-- 6) Editar: igual que antes, más los adjuntos copiados a la versión nueva.
create or replace function public.edit_case_message(p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.case_messages := public.case_own_message(p_id); v_id uuid := gen_random_uuid();
begin
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'mensaje invalido'; end if;
  insert into public.case_messages (id, thread_id, patient_id, root_id, version, author_kind, author_professional_id, body, audience, patient_can_read)
    values (v_id, m.thread_id, m.patient_id, m.root_id, m.version + 1, m.author_kind, m.author_professional_id, btrim(p_body), m.audience, m.patient_can_read);
  insert into public.case_recipients (message_id, professional_id) select v_id, professional_id from public.case_recipients where message_id = m.id;
  insert into public.case_mentions (message_id, professional_id) select v_id, professional_id from public.case_mentions where message_id = m.id;
  insert into public.case_attachments (message_id, patient_id, storage_path, file_name, mime_type, size_bytes, created_at)
    select v_id, patient_id, storage_path, file_name, mime_type, size_bytes, created_at from public.case_attachments where message_id = m.id;
  return v_id;
end $$;

-- 7) El mensaje como JSON: igual que antes, más 'files' (sin la ruta) si se ve el contenido y no está retirado.
create or replace function public.case_message_json(p_id uuid, p_prof uuid, p_hidden boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p_hidden then
    jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'root_id', m.root_id, 'version', m.version, 'hidden', true,
      'author_kind', m.author_kind, 'author_id', m.author_professional_id, 'author_name', a.name, 'author_role', a.role,
      'retracted', m.retracted_at is not null, 'created_at', m.created_at)
  else
    jsonb_build_object('id', m.id, 'thread_id', m.thread_id, 'root_id', m.root_id, 'version', m.version, 'hidden', false,
      'author_kind', m.author_kind, 'author_id', m.author_professional_id, 'author_name', a.name, 'author_role', a.role,
      'body', case when m.retracted_at is null then m.body end, 'retracted', m.retracted_at is not null,
      'audience', m.audience, 'patient_can_read', m.patient_can_read, 'in_journal', m.journal_entry_id is not null, 'created_at', m.created_at,
      'to', coalesce((select jsonb_agg(jsonb_build_object('id', r.professional_id, 'name', p.name) order by p.name)
         from public.case_recipients r join public.professionals p on p.id = r.professional_id where r.message_id = m.id), '[]'::jsonb),
      'mentions', coalesce((select jsonb_agg(x.professional_id) from public.case_mentions x where x.message_id = m.id), '[]'::jsonb),
      'reads', coalesce((select jsonb_agg(jsonb_build_object('professional_id', x.reader_professional, 'name', p.name, 'patient', x.reader_patient, 'at', x.read_at) order by x.read_at)
         from public.case_reads x left join public.professionals p on p.id = x.reader_professional where x.message_id = m.id), '[]'::jsonb),
      'files', case when m.retracted_at is null then coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'mime_type', f.mime_type, 'size_bytes', f.size_bytes) order by f.created_at, f.file_name)
         from public.case_attachments f where f.message_id = m.id), '[]'::jsonb) else '[]'::jsonb end,
      'unread', case when p_prof is null
        then m.author_kind <> 'paciente' and not exists (select 1 from public.case_reads x where x.message_id = m.id and x.reader_patient)
        else m.author_professional_id is distinct from p_prof and not exists (select 1 from public.case_reads x where x.message_id = m.id and x.reader_professional = p_prof) end)
  end
  from public.case_messages m left join public.professionals a on a.id = m.author_professional_id
  where m.id = p_id
$$;
revoke all on function public.case_message_json(uuid, uuid, boolean) from public, anon, authenticated;

-- 8) Abrir un adjunto: mismas reglas de lectura que el mensaje. Profesional: registra acceso 'equipo'. Devuelve la ruta.
create or replace function public.open_case_file(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare f public.case_attachments; m public.case_messages; v_topic text; v_prof uuid;
begin
  select * into f from public.case_attachments where id = p_id;
  if not found then raise exception 'sin permiso'; end if;
  select * into m from public.case_messages where id = f.message_id;
  select topic into v_topic from public.case_threads where id = m.thread_id;
  if m.retracted_at is not null then raise exception 'mensaje retirado'; end if;
  if public.current_patient_id() is not distinct from m.patient_id then
    if not (m.patient_can_read or m.author_kind = 'paciente') then raise exception 'sin permiso'; end if;
  else
    v_prof := public.current_professional_id();
    if v_prof is null or not public.case_can_read_topic(v_prof, m.patient_id, v_topic)
       or not (m.author_professional_id = v_prof or exists (select 1 from public.case_recipients r where r.message_id = m.id and r.professional_id = v_prof)) then
      raise exception 'sin permiso equipo';
    end if;
    insert into public.access_log (professional_id, patient_id, scope) values (v_prof, m.patient_id, 'equipo');
  end if;
  perform public.grant_file('caso', f.storage_path);
  return f.storage_path;
end $$;
revoke all on function public.open_case_file(uuid) from public, anon;
grant execute on function public.open_case_file(uuid) to authenticated;

-- 9) Abrir el archivo de un examen (profesional con permiso 'examenes'). Registra el acceso. Devuelve la ruta.
create or replace function public.open_document_file(p_doc uuid) returns text
language plpgsql security definer set search_path = public as $$
declare d public.documents; v_prof uuid := public.current_professional_id();
begin
  select * into d from public.documents where id = p_doc;
  if not found or d.storage_path is null or v_prof is null or not exists (select 1 from public.care_links l where l.professional_id = v_prof
      and l.patient_id = d.patient_id and l.revoked_at is null and 'examenes' = any (l.scopes)) then
    raise exception 'sin permiso examenes';
  end if;
  insert into public.access_log (professional_id, patient_id, scope) values (v_prof, d.patient_id, 'examenes');
  perform public.grant_file('documentos', d.storage_path);
  return d.storage_path;
end $$;
revoke all on function public.open_document_file(uuid) from public, anon;
grant execute on function public.open_document_file(uuid) to authenticated;
