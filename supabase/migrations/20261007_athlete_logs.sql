-- Registro deportivo diario (autoinformado por el atleta o paciente).
-- Ejecutar una vez en Supabase > SQL Editor. Es idempotente.
-- Supuesto: patients.id es uuid. Si el tipo difiere, el CREATE TABLE falla con un error claro; no deja nada a medias.

create table if not exists public.athlete_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  log_date date not null,
  sleep_hours numeric(3,1) check (sleep_hours between 0 and 16),
  sleep_quality smallint check (sleep_quality between 1 and 10),   -- 10 = durmió muy bien
  fatigue smallint check (fatigue between 1 and 10),               -- 10 = agotado
  mood smallint check (mood between 1 and 10),                     -- 10 = muy bien
  pain_level smallint check (pain_level between 0 and 10),         -- 0 = sin dolor
  pain_zone text,
  trained boolean not null default false,
  session_rpe smallint check (session_rpe between 1 and 10),       -- esfuerzo percibido de la sesión
  session_minutes smallint check (session_minutes between 0 and 600),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, log_date)
);

create index if not exists athlete_logs_patient_date_idx on public.athlete_logs (patient_id, log_date desc);

alter table public.athlete_logs enable row level security;

-- El paciente lee y escribe solo sus propios registros.
drop policy if exists athlete_logs_own_select on public.athlete_logs;
create policy athlete_logs_own_select on public.athlete_logs for select
  using (patient_id in (select id from public.patients where auth_user_id = auth.uid()));

drop policy if exists athlete_logs_own_insert on public.athlete_logs;
create policy athlete_logs_own_insert on public.athlete_logs for insert
  with check (patient_id in (select id from public.patients where auth_user_id = auth.uid()));

drop policy if exists athlete_logs_own_update on public.athlete_logs;
create policy athlete_logs_own_update on public.athlete_logs for update
  using (patient_id in (select id from public.patients where auth_user_id = auth.uid()))
  with check (patient_id in (select id from public.patients where auth_user_id = auth.uid()));

drop policy if exists athlete_logs_own_delete on public.athlete_logs;
create policy athlete_logs_own_delete on public.athlete_logs for delete
  using (patient_id in (select id from public.patients where auth_user_id = auth.uid()));

-- Admins (hoy: Manuel y Diego) solo leen. Cuando existan roles por profesional (Fase 1), esto se reemplaza por has_scope().
drop policy if exists athlete_logs_admin_select on public.athlete_logs;
create policy athlete_logs_admin_select on public.athlete_logs for select
  using (public.is_admin());
