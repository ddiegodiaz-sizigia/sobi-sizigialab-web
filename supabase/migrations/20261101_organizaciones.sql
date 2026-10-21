-- Organizaciones: cada persona pertenece a una organización y el admin solo ve a las personas de la suya.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere todas las migraciones anteriores.
-- Antes: is_admin() = correo en la tabla admins, y todo admin leía a todas las personas.
-- Ahora:
--   * organizations + org_members (correo, como admins). Un admin puede estar en varias organizaciones.
--   * patients.org_id obligatorio; las 5 personas actuales pasan a "Medicina Humana".
--   * Cada política de admin pasa de is_admin() a is_patient_admin(patient_id) / is_org_admin(org_id).
--   * La tabla admins queda como admin de plataforma: crea organizaciones y edita el consentimiento, no lee personas.
--   * El admin ya no lee entradas de salud mental ni ciclo en journal_entries (regla 4); antes podía.
--   * Profesionales: siguen siendo globales (un médico puede atender en varias organizaciones). El admin ve los que
--     registró su organización o los que tienen vínculo con una persona suya; edita o borra solo los suyos sin
--     vínculos fuera de su organización.
--   * Plantillas: por organización. Las 8 de hoy quedan en Medicina Humana.
--   * Correo de persona único en toda la plataforma: el ingreso por magic link reclama una sola fila.
--   * save_document, delete_document y case_own_message: quien no es paciente ya no pasa la revisión (punto 8).
-- Fuera de esta migración: registro de accesos del admin (lee por RLS directo, sin access_log).

-- 1) Tablas
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,40}$'),
  created_at timestamptz not null default now()
);
create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and email like '%@%'),
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, email)
);
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

alter table public.patients add column if not exists org_id uuid references public.organizations(id);
alter table public.professionals add column if not exists created_by_org uuid references public.organizations(id);
alter table public.templates add column if not exists org_id uuid references public.organizations(id);
create index if not exists patients_org_idx on public.patients (org_id);
create index if not exists org_members_email_idx on public.org_members (email);

-- 2) Funciones de permiso
create or replace function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a join auth.users u on lower(u.email) = lower(a.email) where u.id = auth.uid())
$$;

create or replace function public.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.org_id from public.org_members m join auth.users u on lower(u.email) = m.email where u.id = auth.uid()
$$;

create or replace function public.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_org is not null and p_org in (select public.my_org_ids())
$$;

create or replace function public.is_patient_admin(p_patient uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.patients p where p.id = p_patient and p.org_id in (select public.my_org_ids()))
$$;

-- Para storage: la primera carpeta de la ruta es el id de la persona.
create or replace function public.is_patient_admin_path(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select case when p_folder ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then public.is_patient_admin(p_folder::uuid) else false end
$$;

-- is_admin() se mantiene para la puerta de admin.html: admin de al menos una organización.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.my_org_ids())
$$;

-- La organización por defecto de quien inserta: la única de la que es admin; null si no es admin o tiene varias.
create or replace function public.default_org() returns uuid
language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(o))[1] end from public.my_org_ids() o
$$;

create or replace function public.prof_linked_to_my_org(p_prof uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.care_links l join public.patients p on p.id = l.patient_id
                 where l.professional_id = p_prof and p.org_id in (select public.my_org_ids()))
$$;

create or replace function public.prof_linked_outside(p_prof uuid, p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.care_links l join public.patients p on p.id = l.patient_id
                 where l.professional_id = p_prof and p.org_id is distinct from p_org)
$$;

-- 3) Datos actuales a Medicina Humana
insert into public.organizations (name, slug) values ('Medicina Humana', 'medicina-humana') on conflict (slug) do nothing;
insert into public.org_members (org_id, email)
  select o.id, lower(btrim(a.email)) from public.admins a, public.organizations o where o.slug = 'medicina-humana'
  on conflict do nothing;
update public.patients set org_id = (select id from public.organizations where slug = 'medicina-humana') where org_id is null;
update public.professionals set created_by_org = (select id from public.organizations where slug = 'medicina-humana') where created_by_org is null;
update public.templates set org_id = (select id from public.organizations where slug = 'medicina-humana') where org_id is null;
alter table public.patients alter column org_id set not null;
alter table public.templates alter column org_id set not null;
create unique index if not exists patients_email_unique on public.patients (lower(email)) where email is not null;

-- 4) Al insertar, la organización del admin; nadie cambia de organización desde la app (sí desde SQL Editor).
create or replace function public.set_org_on_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_col text := case when tg_table_name = 'professionals' then 'created_by_org' else 'org_id' end;
        v_org uuid := (to_jsonb(new) ->> v_col)::uuid;
begin
  if tg_op = 'INSERT' then
    if v_org is null and public.is_admin() then
      v_org := public.default_org();
      if v_org is null then raise exception 'elige la organización'; end if;
    end if;
  elsif v_org is distinct from (to_jsonb(old) ->> v_col)::uuid and auth.uid() is not null then
    raise exception 'no se puede cambiar la organización';
  end if;
  return jsonb_populate_record(new, jsonb_build_object(v_col, v_org));
end $$;

drop trigger if exists patients_set_org on public.patients;
create trigger patients_set_org before insert or update on public.patients for each row execute function public.set_org_on_insert();
drop trigger if exists templates_set_org on public.templates;
create trigger templates_set_org before insert or update on public.templates for each row execute function public.set_org_on_insert();
drop trigger if exists professionals_set_org on public.professionals;
create trigger professionals_set_org before insert or update on public.professionals for each row execute function public.set_org_on_insert();

-- 5) Políticas
drop policy if exists organizations_member_select on public.organizations;
create policy organizations_member_select on public.organizations for select using (public.is_org_admin(id) or public.is_platform_admin());
drop policy if exists organizations_platform_all on public.organizations;
create policy organizations_platform_all on public.organizations for all using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists org_members_member_select on public.org_members;
create policy org_members_member_select on public.org_members for select using (public.is_org_admin(org_id) or public.is_platform_admin());
drop policy if exists org_members_platform_all on public.org_members;
create policy org_members_platform_all on public.org_members for all using (public.is_platform_admin()) with check (public.is_platform_admin());

-- Tablas con patient_id: misma política y mismo nombre, ahora acotada a las personas de la organización del admin.
do $$
declare r text[]; v_check text;
begin
  foreach r slice 1 in array array[
    ['access_log','access_log_admin_select','select'],
    ['athlete_logs','athlete_logs_admin_select','select'],
    ['biomarker_results','biomarker_admin_select','select'],
    ['care_links','care_links_admin_select','select'],
    ['checkins','checkins_admin_read','select'],
    ['coach_contacts','coach_contacts_admin_select','select'],
    ['documents','documents_admin_select','select'],
    ['injuries','injuries_admin_all','all'],
    ['injury_pain_logs','injury_pain_admin_all','all'],
    ['log_settings','log_settings_admin_select','select'],
    ['meal_logs','meal_logs_admin_select','select'],
    ['measurements','measurements_admin_read','select'],
    ['nutrition_plans','nutrition_plans_admin_select','select'],
    ['patient_exams','patient_exams_admin_all','all'],
    ['patient_logins','patient_logins_admin_all','all'],
    ['patient_objectives','patient_objectives_admin_all','all'],
    ['program_days','program_days_admin_all','all'],
    ['transcripts','transcripts_admin_all','all'],
    ['wellness_logs','wellness_logs_admin_select','select']
  ] loop
    v_check := case when r[3] = 'all' then ' with check (public.is_patient_admin(patient_id))' else '' end;
    execute format('drop policy if exists %I on public.%I', r[2], r[1]);
    execute format('create policy %I on public.%I for %s using (public.is_patient_admin(patient_id))%s', r[2], r[1], r[3], v_check);
  end loop;
end $$;

drop policy if exists patients_admin_all on public.patients;
create policy patients_admin_all on public.patients for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

drop policy if exists templates_admin_all on public.templates;
create policy templates_admin_all on public.templates for all using (public.is_org_admin(org_id)) with check (public.is_org_admin(org_id));

-- Bitácora: el admin lee lo de su organización salvo salud mental y ciclo. Escribe solo por las funciones.
drop policy if exists journal_admin_all on public.journal_entries;
drop policy if exists journal_admin_select on public.journal_entries;
create policy journal_admin_select on public.journal_entries for select
  using (public.is_patient_admin(patient_id) and scope not in ('salud_mental', 'ciclo'));

drop policy if exists professionals_admin_all on public.professionals;
drop policy if exists professionals_admin_select on public.professionals;
drop policy if exists professionals_admin_insert on public.professionals;
drop policy if exists professionals_admin_update on public.professionals;
drop policy if exists professionals_admin_delete on public.professionals;
create policy professionals_admin_select on public.professionals for select
  using (public.is_org_admin(created_by_org) or public.prof_linked_to_my_org(id));
create policy professionals_admin_insert on public.professionals for insert with check (public.is_org_admin(created_by_org));
create policy professionals_admin_update on public.professionals for update
  using (public.is_org_admin(created_by_org) and not public.prof_linked_outside(id, created_by_org))
  with check (public.is_org_admin(created_by_org));
create policy professionals_admin_delete on public.professionals for delete
  using (public.is_org_admin(created_by_org) and not public.prof_linked_outside(id, created_by_org));

drop policy if exists consent_texts_admin_write on public.consent_texts;
create policy consent_texts_admin_write on public.consent_texts for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists documentos_admin_all on storage.objects;
create policy documentos_admin_all on storage.objects for all to authenticated
  using (bucket_id = 'documentos' and public.is_patient_admin_path((storage.foldername(name))[1]))
  with check (bucket_id = 'documentos' and public.is_patient_admin_path((storage.foldername(name))[1]));
drop policy if exists patient_exams_admin_all on storage.objects;
create policy patient_exams_admin_all on storage.objects for all
  using (bucket_id = 'patient-exams' and public.is_patient_admin_path((storage.foldername(name))[1]))
  with check (bucket_id = 'patient-exams' and public.is_patient_admin_path((storage.foldername(name))[1]));

-- 6) Crear una organización con su primer admin (admin de plataforma o SQL Editor).
create or replace function public.create_organization(p_name text, p_slug text, p_admin_email text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.is_platform_admin() then raise exception 'sin permiso'; end if;
  insert into public.organizations (name, slug) values (btrim(p_name), lower(btrim(p_slug))) returning id into v_id;
  insert into public.org_members (org_id, email) values (v_id, lower(btrim(p_admin_email)));
  return v_id;
end $$;
revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- 7) Funciones que aceptaban a cualquier admin: ahora solo al admin de la organización de esa persona.
--    Mismo cuerpo que en su migración de origen; cambia la línea de is_admin() (y en documentos, la del punto 8).
create or replace function public.injuries_to_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := new.zone || case new.side when 'izquierda' then ' (lado izquierdo)' when 'derecha' then ' (lado derecho)' when 'bilateral' then ' (bilateral)' else '' end;
  v_title text; v_body text; v_changes text[] := '{}';
  v_author text := case when public.is_patient_admin(new.patient_id) then 'admin' when public.current_patient_id() = new.patient_id then 'paciente' else 'profesional' end;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    v_title := 'Nueva lesión: ' || v_name;
    v_body := new.title || coalesce('. EVA inicial ' || new.eva_initial || '/10', '') || coalesce('. Tratante: ' || new.treating, '');
  elsif old.status <> new.status then
    v_title := case
      when new.status = 'alta' then 'Alta: ' || v_name
      when old.status = 'alta' then 'Recaída: ' || v_name
      when new.status = 'rehabilitacion' then 'En rehabilitación: ' || v_name
      else 'Lesión activa de nuevo: ' || v_name end;
    v_body := new.title || case when new.status = 'alta' then '. Alta el ' || to_char(new.discharge_date, 'DD-MM-YYYY') else '' end;
  else
    if old.zone is distinct from new.zone or old.side is distinct from new.side then v_changes := array_append(v_changes, 'zona'); end if;
    if old.title is distinct from new.title then v_changes := array_append(v_changes, 'descripción'); end if;
    if old.onset_date is distinct from new.onset_date then v_changes := array_append(v_changes, 'fecha de inicio'); end if;
    if old.eva_initial is distinct from new.eva_initial then v_changes := array_append(v_changes, 'EVA inicial'); end if;
    if old.treating is distinct from new.treating then v_changes := array_append(v_changes, 'tratante'); end if;
    if old.discharge_date is distinct from new.discharge_date then v_changes := array_append(v_changes, 'fecha de alta'); end if;
    if old.notes is distinct from new.notes then v_changes := array_append(v_changes, 'notas'); end if;
    if cardinality(v_changes) = 0 then return new; end if;
    v_title := 'Lesión actualizada: ' || v_name;
    v_body := 'Cambió: ' || array_to_string(v_changes, ', ') || '.' || coalesce(' Notas: ' || new.notes, '');
  end if;
  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, scope)
    values (new.patient_id, case when tg_op = 'INSERT' then new.onset_date else current_date end, 'lesion', v_title, v_body, v_author, 'lesiones');
  return new;
end $$;

create or replace function public.set_log_settings(p_patient uuid, p_mode text, p_frequency text, p_habits text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid := coalesce(p_patient, public.current_patient_id());
  v_prof uuid := public.current_professional_id();
  v_by text; v_prof_name text; v_freq text; v_habits text[]; v_old public.log_settings;
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if v_patient = public.current_patient_id() then v_by := 'paciente';
  elsif public.is_patient_admin(v_patient) then v_by := 'admin';
  elsif v_prof is not null and exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = v_patient
      and l.revoked_at is null and 'semaforo' = any (l.scopes)) then v_by := 'profesional';
  else raise exception 'sin permiso'; end if;
  if p_mode not in ('deportivo','comun') then raise exception 'tipo de registro invalido'; end if;
  if p_frequency not in ('diaria','semanal') then raise exception 'frecuencia invalida'; end if;
  v_freq := case when p_mode = 'deportivo' then 'diaria' else p_frequency end;
  v_habits := coalesce(array(select trim(h) from unnest(coalesce(p_habits, '{}')) with ordinality u(h, n) order by n), '{}');
  if cardinality(v_habits) > 8 then raise exception 'maximo 8 habitos'; end if;
  if exists (select 1 from unnest(v_habits) h where length(h) < 2 or length(h) > 40) then raise exception 'habito invalido'; end if;
  if (select count(distinct lower(h)) from unnest(v_habits) h) <> cardinality(v_habits) then raise exception 'habito repetido'; end if;
  select * into v_old from public.log_settings where patient_id = v_patient;
  if found and v_old.mode = p_mode and v_old.frequency = v_freq and v_old.habits = v_habits then return; end if;
  if v_by = 'profesional' then select name into v_prof_name from public.professionals where id = v_prof; end if;
  insert into public.log_settings (patient_id, mode, frequency, habits, set_by, set_by_professional, updated_at)
    values (v_patient, p_mode, v_freq, v_habits, v_by, case when v_by = 'profesional' then v_prof end, now())
    on conflict (patient_id) do update set mode = excluded.mode, frequency = excluded.frequency, habits = excluded.habits,
      set_by = excluded.set_by, set_by_professional = excluded.set_by_professional, updated_at = now();
  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, author_professional_id, scope)
    values (v_patient, current_date, 'plan',
      'Registro: ' || case when p_mode = 'deportivo' then 'deportivo diario' when v_freq = 'semanal' then 'general semanal' else 'general diario' end,
      case when p_mode = 'deportivo' then 'Sueño, fatiga, ánimo, dolor y carga de cada sesión.'
           when cardinality(v_habits) = 0 then 'Energía, sueño y estrés. Sin hábitos definidos.'
           else 'Energía, sueño y estrés. Hábitos: ' || array_to_string(v_habits, ', ') || '.' end
      || case when v_prof_name is not null then ' Definido por ' || v_prof_name || '.' else '' end,
      v_by, case when v_by = 'profesional' then v_prof end, 'bitacora');
end $$;

create or replace function public.save_document(p_patient uuid, p_doc jsonb, p_results jsonb default '[]'::jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_patient_admin(p_patient);
  v_id uuid := nullif(p_doc->>'id', '')::uuid;
  v_prev public.documents;
  v_path text := nullif(p_doc->>'storage_path', '');
  v_date date := (p_doc->>'doc_date')::date;
begin
  if p_patient is null or not (v_admin or coalesce(p_patient = public.current_patient_id(), false)) then raise exception 'sin permiso'; end if;
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

create or replace function public.delete_document(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_doc public.documents; v_admin boolean;
begin
  select * into v_doc from public.documents where id = p_id;
  v_admin := found and public.is_patient_admin(v_doc.patient_id);
  if not found or not (v_admin or coalesce(v_doc.patient_id = public.current_patient_id(), false)) then raise exception 'sin permiso'; end if;
  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, scope)
  values (v_doc.patient_id, current_date, 'examen', 'Documento eliminado: ' || v_doc.title,
          'Del ' || to_char(v_doc.doc_date, 'DD-MM-YYYY') || '.', case when v_admin then 'admin' else 'paciente' end, 'examenes');
  delete from public.documents where id = p_id;
  return v_doc.storage_path;
end $$;

create or replace function public.set_nutrition_plan(p_patient uuid, p_meals jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_patient_admin(p_patient);
  v_prof uuid := public.current_professional_id();
  v_kind text; v_id uuid; v_prev public.nutrition_plans; v_changes text[] := '{}'; v_names text;
  m jsonb; o jsonb;
begin
  if p_patient is null then raise exception 'sin permiso'; end if;
  if p_patient = public.current_patient_id() then v_kind := 'paciente'; v_prof := null;
  elsif v_admin then v_kind := 'admin'; v_prof := null;
  elsif v_prof is not null and exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'nutricion' = any (l.scopes)) then v_kind := 'profesional';
  else raise exception 'sin permiso'; end if;

  if jsonb_typeof(p_meals) <> 'array' or jsonb_array_length(p_meals) not between 1 and 8 then raise exception 'el plan lleva de 1 a 8 comidas'; end if;
  if exists (select 1 from jsonb_array_elements(p_meals) e where coalesce(btrim(e->>'name'), '') = '' or coalesce(e->>'key', '') = '') then
    raise exception 'cada comida necesita nombre'; end if;
  if (select count(distinct e->>'key') from jsonb_array_elements(p_meals) e) <> jsonb_array_length(p_meals) then raise exception 'comidas repetidas'; end if;

  select * into v_prev from public.nutrition_plans where patient_id = p_patient order by created_at desc limit 1;
  insert into public.nutrition_plans (patient_id, meals, notes, author_kind, author_professional_id)
  values (p_patient, p_meals, nullif(btrim(p_notes), ''), v_kind, v_prof) returning id into v_id;

  select string_agg(e->>'name', ', ' order by n) into v_names from jsonb_array_elements(p_meals) with ordinality as t(e, n);
  if v_prev.id is not null then
    for m in select e from jsonb_array_elements(p_meals) e loop
      select e into o from jsonb_array_elements(v_prev.meals) e where e->>'key' = m->>'key';
      if o is null then v_changes := array_append(v_changes, 'nueva: ' || (m->>'name'));
      elsif o->>'name' is distinct from m->>'name' or coalesce(o->>'time', '') is distinct from coalesce(m->>'time', '')
         or coalesce(o->>'guide', '') is distinct from coalesce(m->>'guide', '') then v_changes := array_append(v_changes, m->>'name'); end if;
    end loop;
    for o in select e from jsonb_array_elements(v_prev.meals) e loop
      if not exists (select 1 from jsonb_array_elements(p_meals) e where e->>'key' = o->>'key') then v_changes := array_append(v_changes, 'sin: ' || (o->>'name')); end if;
    end loop;
    if coalesce(v_prev.notes, '') is distinct from coalesce(nullif(btrim(p_notes), ''), '') then v_changes := array_append(v_changes, 'indicaciones'); end if;
  end if;

  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, author_professional_id, scope)
  values (p_patient, current_date, 'plan',
    case when v_prev.id is null then 'Nuevo plan de alimentación' else 'Plan de alimentación actualizado' end,
    jsonb_array_length(p_meals) || case when jsonb_array_length(p_meals) = 1 then ' comida: ' else ' comidas: ' end || v_names || '.'
      || case when cardinality(v_changes) > 0 then ' Cambió: ' || array_to_string(v_changes, ', ') || '.' else '' end,
    v_kind, v_prof, 'nutricion');
  return v_id;
end $$;

-- 8) Comparaciones con current_patient_id() que daban null para quien no es paciente (un profesional o un admin de
--    otra organización): "not (false or null)" no lanzaba el error. Ahora null cuenta como "no es la persona".
--    save_document y delete_document ya quedaron corregidas arriba; case_own_message (editar, retirar, pasar a la
--    hoja de vida) dejaba a un profesional modificar un mensaje de la persona.
create or replace function public.case_own_message(p_id uuid) returns public.case_messages
language plpgsql stable security definer set search_path = public as $$
declare m public.case_messages; v_prof uuid := public.current_professional_id();
begin
  select * into m from public.case_messages where id = p_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  if not coalesce((m.author_kind = 'paciente' and m.patient_id = public.current_patient_id())
       or (m.author_kind = 'profesional' and m.author_professional_id = v_prof
           and public.case_can_read_topic(v_prof, m.patient_id, (select topic from public.case_threads where id = m.thread_id))), false) then
    raise exception 'sin permiso';
  end if;
  if exists (select 1 from public.case_messages n where n.root_id = m.root_id and n.version > m.version) then raise exception 'hay una version mas nueva'; end if;
  if m.retracted_at is not null then raise exception 'mensaje retirado'; end if;
  if m.journal_entry_id is not null then raise exception 'ya esta en la hoja de vida'; end if;
  return m;
end $$;
