-- Exámenes y documentos: subida de archivos (bucket privado 'documentos'), biomarcadores por documento y entrada
-- automática en la bitácora. Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql y
-- 20261020_bitacora_sexo_ciclo.sql.
-- Escritura solo por funciones (save_document, delete_document): así documento + resultados + entrada en la bitácora
-- quedan en una sola transacción. La persona y el admin escriben; un profesional con permiso 'examenes' solo lee por
-- patient_examenes(), que registra el acceso. El archivo en sí no lo ve el profesional todavía (requiere firmar la URL
-- desde una Edge Function que también registre el acceso).
-- Los rangos de referencia son los del laboratorio (la app sugiere uno general editable). Fuera de rango es informativo.

-- 1) Bucket privado. Ruta: <patient_id>/<archivo>. 10 MB, PDF e imágenes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos', 'documentos', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists documentos_patient_select on storage.objects;
create policy documentos_patient_select on storage.objects for select to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.current_patient_id()::text);
drop policy if exists documentos_patient_insert on storage.objects;
create policy documentos_patient_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.current_patient_id()::text);
drop policy if exists documentos_patient_delete on storage.objects;
create policy documentos_patient_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documentos' and (storage.foldername(name))[1] = public.current_patient_id()::text);
drop policy if exists documentos_admin_all on storage.objects;
create policy documentos_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'documentos' and public.is_admin()) with check (bucket_id = 'documentos' and public.is_admin());

-- 2) Documentos (con o sin archivo: un examen se puede registrar a mano solo con sus resultados)
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  doc_date date not null,
  category text not null check (category in ('laboratorio','imagen','informe','receta','otro')),
  title text not null check (length(btrim(title)) > 0),
  issuer text,                 -- laboratorio, clínica o profesional que lo emite
  notes text,
  storage_path text unique,    -- <patient_id>/<archivo> en el bucket 'documentos'
  file_name text,
  mime_type text,
  size_bytes integer,
  created_by_kind text not null check (created_by_kind in ('paciente','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists documents_patient_idx on public.documents (patient_id, doc_date desc);

-- 3) Resultados (biomarcadores) de cada documento
create table if not exists public.biomarker_results (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  result_date date not null,
  position smallint not null default 0,
  marker text not null,        -- código del catálogo (assets/examenes.js) u 'otro:<nombre>'
  marker_name text not null,
  value numeric not null,
  unit text,
  ref_low numeric,
  ref_high numeric,
  created_at timestamptz not null default now(),
  unique (document_id, marker),
  constraint biomarker_ref_orden check (ref_low is null or ref_high is null or ref_low <= ref_high)
);
create index if not exists biomarker_results_patient_idx on public.biomarker_results (patient_id, marker, result_date);

-- 4) RLS: la persona lee lo suyo, el admin todo. Nadie escribe directo (solo las funciones).
alter table public.documents enable row level security;
alter table public.biomarker_results enable row level security;
drop policy if exists documents_patient_select on public.documents;
create policy documents_patient_select on public.documents for select using (patient_id = public.current_patient_id());
drop policy if exists documents_admin_select on public.documents;
create policy documents_admin_select on public.documents for select using (public.is_admin());
drop policy if exists biomarker_patient_select on public.biomarker_results;
create policy biomarker_patient_select on public.biomarker_results for select using (patient_id = public.current_patient_id());
drop policy if exists biomarker_admin_select on public.biomarker_results;
create policy biomarker_admin_select on public.biomarker_results for select using (public.is_admin());

-- 5) Texto de la bitácora. Mantener en sincronía con journalText() de assets/examenes.js.
create or replace function public.document_journal_body(p_doc uuid) returns text
language sql stable security definer set search_path = public as $$
  select case d.category when 'laboratorio' then 'Examen de laboratorio' when 'imagen' then 'Imagen' when 'informe' then 'Informe'
           when 'receta' then 'Receta o indicación' else 'Documento' end
    || coalesce(' · ' || nullif(btrim(d.issuer), ''), '') || '.'
    || case when r.n = 0 then '' else ' ' || r.n || case when r.n = 1 then ' resultado' else ' resultados' end
         || case when r.m > 0 then ', ' || r.m || ' fuera del rango de referencia: ' || r.names else '' end || '.' end
  from public.documents d,
  lateral (select count(*) as n,
                  count(*) filter (where b.value < b.ref_low or b.value > b.ref_high) as m,
                  string_agg(b.marker_name, ', ' order by b.position) filter (where b.value < b.ref_low or b.value > b.ref_high) as names
           from public.biomarker_results b where b.document_id = d.id) r
  where d.id = p_doc
$$;
revoke all on function public.document_journal_body(uuid) from public, anon;

-- 6) Crear o editar un documento con sus resultados (reemplaza los resultados). Devuelve el id.
-- p_doc: {id?, doc_date, category, title, issuer, notes, storage_path, file_name, mime_type, size_bytes}
-- p_results: [{marker, marker_name, value, unit, ref_low, ref_high}]
create or replace function public.save_document(p_patient uuid, p_doc jsonb, p_results jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
  v_id uuid := nullif(p_doc->>'id', '')::uuid;
  v_prev public.documents;
  v_path text := nullif(p_doc->>'storage_path', '');
  v_date date := (p_doc->>'doc_date')::date;
begin
  if p_patient is null or not (v_admin or p_patient = public.current_patient_id()) then raise exception 'sin permiso'; end if;
  if v_date is null or v_date > current_date then raise exception 'fecha inválida'; end if;
  if v_id is not null then
    select * into v_prev from public.documents where id = v_id and patient_id = p_patient;
    if not found then raise exception 'documento no encontrado'; end if;
    if v_prev.storage_path is not null then v_path := v_prev.storage_path; end if;   -- el archivo no se cambia
  end if;
  if v_path is not null and split_part(v_path, '/', 1) <> p_patient::text then raise exception 'ruta de archivo inválida'; end if;

  if v_id is null then
    insert into public.documents (patient_id, doc_date, category, title, issuer, notes, storage_path, file_name, mime_type, size_bytes, created_by_kind)
    values (p_patient, v_date, p_doc->>'category', btrim(p_doc->>'title'), nullif(btrim(p_doc->>'issuer'), ''), nullif(btrim(p_doc->>'notes'), ''),
            v_path, p_doc->>'file_name', p_doc->>'mime_type', (p_doc->>'size_bytes')::int, case when v_admin then 'admin' else 'paciente' end)
    returning id into v_id;
  else
    update public.documents set doc_date = v_date, category = p_doc->>'category', title = btrim(p_doc->>'title'),
      issuer = nullif(btrim(p_doc->>'issuer'), ''), notes = nullif(btrim(p_doc->>'notes'), ''), storage_path = v_path,
      file_name = coalesce(v_prev.file_name, p_doc->>'file_name'), mime_type = coalesce(v_prev.mime_type, p_doc->>'mime_type'),
      size_bytes = coalesce(v_prev.size_bytes, (p_doc->>'size_bytes')::int), updated_at = now()
    where id = v_id;
    delete from public.biomarker_results where document_id = v_id;
  end if;

  insert into public.biomarker_results (document_id, patient_id, result_date, position, marker, marker_name, value, unit, ref_low, ref_high)
  select v_id, p_patient, v_date, (e.ord - 1)::smallint, e.r->>'marker', btrim(e.r->>'marker_name'), (e.r->>'value')::numeric,
         nullif(btrim(e.r->>'unit'), ''), nullif(e.r->>'ref_low', '')::numeric, nullif(e.r->>'ref_high', '')::numeric
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) with ordinality as e(r, ord);

  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, scope)
  values (p_patient, case when v_prev.id is null then v_date else current_date end, 'examen',
          case when v_prev.id is null then 'Nuevo documento: ' else 'Documento actualizado: ' end || btrim(p_doc->>'title'),
          public.document_journal_body(v_id), case when v_admin then 'admin' else 'paciente' end, 'examenes');
  return v_id;
end $$;
revoke all on function public.save_document(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_document(uuid, jsonb, jsonb) to authenticated;

-- 7) Eliminar: borra la fila (y sus resultados) y deja constancia en la bitácora. Devuelve la ruta del archivo
-- para que la app lo borre del bucket.
create or replace function public.delete_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_doc public.documents; v_admin boolean := public.is_admin();
begin
  select * into v_doc from public.documents where id = p_id;
  if not found or not (v_admin or v_doc.patient_id = public.current_patient_id()) then raise exception 'sin permiso'; end if;
  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, scope)
  values (v_doc.patient_id, current_date, 'examen', 'Documento eliminado: ' || v_doc.title,
          'Del ' || to_char(v_doc.doc_date, 'DD-MM-YYYY') || '.', case when v_admin then 'admin' else 'paciente' end, 'examenes');
  delete from public.documents where id = p_id;
  return v_doc.storage_path;
end $$;
revoke all on function public.delete_document(uuid) from public, anon;
grant execute on function public.delete_document(uuid) to authenticated;

-- 8) Lo que ve un profesional con permiso 'examenes' sobre UNA persona (sin el archivo). Registra el acceso.
create or replace function public.patient_examenes(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null or not exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'examenes' = any (l.scopes)) then
    raise exception 'sin permiso examenes';
  end if;
  insert into public.access_log (professional_id, patient_id, scope) values (v_prof, p_patient, 'examenes');
  return jsonb_build_object(
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_date', d.doc_date, 'category', d.category, 'title', d.title,
        'issuer', d.issuer, 'notes', d.notes, 'has_file', d.storage_path is not null) order by d.doc_date desc)
      from public.documents d where d.patient_id = p_patient), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object('document_id', b.document_id, 'result_date', b.result_date, 'marker', b.marker,
        'marker_name', b.marker_name, 'value', b.value, 'unit', b.unit, 'ref_low', b.ref_low, 'ref_high', b.ref_high) order by b.result_date, b.position)
      from public.biomarker_results b where b.patient_id = p_patient), '[]'::jsonb));
end $$;
revoke all on function public.patient_examenes(uuid) from public, anon;
grant execute on function public.patient_examenes(uuid) to authenticated;
