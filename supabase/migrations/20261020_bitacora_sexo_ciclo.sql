-- Bitácora continua (hoja de vida), sexo al alta y seguimiento de ciclo. Ejecutar en Supabase > SQL Editor. Idempotente.
-- Requiere 20261008_care_links.sql. NO borra nada: los planes 3m/6m quedan como columnas heredadas sin efecto comercial.

-- 1) Sexo al crear el usuario. Habilita el módulo de ciclo y las referencias clínicas por sexo.
alter table public.patients add column if not exists sex text check (sex in ('femenino','masculino','no_indica'));
-- Cualquier persona puede activar el seguimiento de ciclo aunque su sexo registrado sea otro.
alter table public.patients add column if not exists tracks_cycle boolean not null default false;

-- 2) Sin plazo: program_months deja de ser obligatorio. La bitácora vive mientras exista la cuenta.
alter table public.patients alter column program_months drop not null;
alter table public.patients add column if not exists journey_started_at timestamptz not null default now();

-- 3) Más permisos por tipo de dato (las funciones que sirven cada uno se agregan después).
alter table public.care_links drop constraint if exists care_links_scopes_check;
alter table public.care_links add constraint care_links_scopes_check
  check (scopes <@ array['semaforo','ciclo','lesiones','nutricion','examenes','salud_mental','bitacora']::text[]);

-- 4) Ciclo menstrual. Solo la persona lo lee y escribe. Ni admin ni profesionales por RLS directo:
--    un profesional con permiso 'ciclo' lo verá por una función con registro de acceso (pendiente).
create table if not exists public.cycle_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  log_date date not null,
  bleeding boolean not null default false,
  flow smallint check (flow between 0 and 3),
  cycle_day smallint check (cycle_day between 1 and 90),
  symptoms text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (patient_id, log_date)
);
alter table public.cycle_logs enable row level security;
drop policy if exists cycle_logs_patient_all on public.cycle_logs;
create policy cycle_logs_patient_all on public.cycle_logs for all
  using (patient_id = public.current_patient_id()) with check (patient_id = public.current_patient_id());

-- 5) Bitácora / hoja de vida: una línea de tiempo por persona, desde que abre su usuario.
create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  entry_date date not null default current_date,
  kind text not null check (kind in ('nota','consulta','examen','lesion','plan','hito','objetivo','suplemento','medicamento')),
  title text not null,
  body text,
  author_kind text not null check (author_kind in ('paciente','profesional','admin')),
  author_professional_id uuid references public.professionals(id),
  scope text not null default 'bitacora' check (scope in ('bitacora','lesiones','nutricion','examenes','salud_mental','ciclo')),
  visible_to_patient boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists journal_entries_patient_idx on public.journal_entries (patient_id, entry_date desc);
alter table public.journal_entries enable row level security;
drop policy if exists journal_patient_select on public.journal_entries;
create policy journal_patient_select on public.journal_entries for select
  using (patient_id = public.current_patient_id() and visible_to_patient);
drop policy if exists journal_patient_insert on public.journal_entries;
create policy journal_patient_insert on public.journal_entries for insert
  with check (patient_id = public.current_patient_id() and author_kind = 'paciente' and scope <> 'salud_mental');
drop policy if exists journal_admin_all on public.journal_entries;
create policy journal_admin_all on public.journal_entries for all using (public.is_admin()) with check (public.is_admin());
