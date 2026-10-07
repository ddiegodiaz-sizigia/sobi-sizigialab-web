-- Roles por profesional, consentimiento revocable y registro de accesos (v0).
-- Requiere 20261007_athlete_logs.sql. Ejecutar en Supabase > SQL Editor. Es idempotente.
-- Alcance v0: un solo permiso, 'semaforo' (registro deportivo sin notas libres). El paciente concede y revoca.
-- Los profesionales NUNCA leen tablas del paciente: solo pasan por funciones que filtran por vínculo activo y registran el acceso.
-- Decisión legal pendiente (no resuelta acá): texto de consentimiento y responsable de la ficha. consent_version queda registrado en cada vínculo.

create table if not exists public.professionals (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text not null,
  name text not null,
  role text not null check (role in ('medico','entrenador','preparador','psicologo','nutricionista','kinesiologo','familia','otro')),
  created_at timestamptz not null default now()
);
create unique index if not exists professionals_email_lower_idx on public.professionals (lower(email));

create table if not exists public.care_links (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  scopes text[] not null default '{}' check (scopes <@ array['semaforo']::text[]),
  consent_version text not null default 'v0-2026-10',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists care_links_active_idx on public.care_links (patient_id, professional_id) where revoked_at is null;

create table if not exists public.access_log (
  id bigint generated always as identity primary key,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  scope text not null,
  accessed_at timestamptz not null default now()
);
create index if not exists access_log_patient_idx on public.access_log (patient_id, accessed_at desc);

alter table public.professionals enable row level security;
alter table public.care_links enable row level security;
alter table public.access_log enable row level security;

-- Funciones auxiliares (security definer para no depender de RLS al resolver identidad)
create or replace function public.current_professional_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.professionals where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.current_patient_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.patients where auth_user_id = auth.uid() limit 1
$$;

-- Políticas: solo lectura acotada. Toda escritura de no-admins pasa por las funciones de más abajo.
drop policy if exists professionals_admin_all on public.professionals;
create policy professionals_admin_all on public.professionals for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists professionals_self_select on public.professionals;
create policy professionals_self_select on public.professionals for select using (auth_user_id = auth.uid());

drop policy if exists care_links_patient_select on public.care_links;
create policy care_links_patient_select on public.care_links for select using (patient_id = public.current_patient_id());
drop policy if exists care_links_professional_select on public.care_links;
create policy care_links_professional_select on public.care_links for select using (professional_id = public.current_professional_id());
drop policy if exists care_links_admin_select on public.care_links;
create policy care_links_admin_select on public.care_links for select using (public.is_admin());

drop policy if exists access_log_patient_select on public.access_log;
create policy access_log_patient_select on public.access_log for select using (patient_id = public.current_patient_id());
drop policy if exists access_log_admin_select on public.access_log;
create policy access_log_admin_select on public.access_log for select using (public.is_admin());

-- El profesional reclama su fila la primera vez que entra con magic link (mismo patrón que patients).
create or replace function public.claim_professional() returns boolean
language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or v_email = '' then return false; end if;
  update public.professionals set auth_user_id = auth.uid()
    where auth_user_id is null and lower(email) = v_email;
  return exists (select 1 from public.professionals where auth_user_id = auth.uid());
end $$;

-- Lista de profesionales que un paciente puede elegir (solo nombre y rol).
create or replace function public.list_professionals() returns table (id uuid, name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.role from public.professionals p
  where public.current_patient_id() is not null order by p.name
$$;

-- El paciente concede (o actualiza) un permiso. Siempre sobre sí mismo.
create or replace function public.grant_care_link(p_professional uuid, p_scopes text[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id();
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if not exists (select 1 from public.professionals where id = p_professional) then raise exception 'profesional inexistente'; end if;
  update public.care_links set scopes = p_scopes
    where patient_id = v_patient and professional_id = p_professional and revoked_at is null;
  if not found then
    insert into public.care_links (patient_id, professional_id, scopes) values (v_patient, p_professional, p_scopes);
  end if;
end $$;

create or replace function public.revoke_care_link(p_professional uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id();
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  update public.care_links set revoked_at = now()
    where patient_id = v_patient and professional_id = p_professional and revoked_at is null;
end $$;

-- Lo que ve un profesional: registro deportivo (sin notas libres) de los pacientes con vínculo activo y permiso 'semaforo'.
-- Registra un acceso por paciente en cada llamada.
create or replace function public.coach_feed() returns table (
  patient_id uuid, patient_name text, log_date date, sleep_hours numeric, sleep_quality smallint, fatigue smallint,
  mood smallint, pain_level smallint, pain_zone text, trained boolean, session_rpe smallint, session_minutes smallint)
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null then return; end if;
  insert into public.access_log (professional_id, patient_id, scope)
    select v_prof, l.patient_id, 'semaforo' from public.care_links l
    where l.professional_id = v_prof and l.revoked_at is null and 'semaforo' = any (l.scopes);
  return query
    select pt.id, pt.name, a.log_date, a.sleep_hours, a.sleep_quality, a.fatigue, a.mood, a.pain_level, a.pain_zone,
           a.trained, a.session_rpe, a.session_minutes
    from public.care_links l
    join public.patients pt on pt.id = l.patient_id
    left join public.athlete_logs a on a.patient_id = l.patient_id and a.log_date >= current_date - 60
    where l.professional_id = v_prof and l.revoked_at is null and 'semaforo' = any (l.scopes);
end $$;

revoke all on function public.current_professional_id(), public.current_patient_id(), public.claim_professional(),
  public.list_professionals(), public.grant_care_link(uuid, text[]), public.revoke_care_link(uuid), public.coach_feed() from public, anon;
grant execute on function public.current_professional_id(), public.current_patient_id(), public.claim_professional(),
  public.list_professionals(), public.grant_care_link(uuid, text[]), public.revoke_care_link(uuid), public.coach_feed() to authenticated;
