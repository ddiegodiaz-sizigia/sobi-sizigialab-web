-- Lesiones y rehabilitación: historial por lesión + dolor diario (EVA) enlazado a la lesión abierta.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql y 20261020_bitacora_sexo_ciclo.sql.
-- Cada alta, cambio de estado o edición de una lesión deja una entrada en journal_entries (kind 'lesion', scope 'lesiones')
-- mediante trigger, sin importar desde dónde se edite (app de la persona, admin o una función futura del profesional).
-- El dolor diario NO genera entrada en la bitácora: llenaría la hoja de vida de ruido. Se ve como gráfico en la lesión.
-- Acceso: la persona (todo lo suyo), admin (Manuel como tratante; mismo nivel que athlete_logs, ver bloqueante multi-tenant)
-- y un profesional con permiso 'lesiones' solo vía patient_lesiones(), que registra el acceso.

-- 1) Lesiones
create table if not exists public.injuries (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  onset_date date not null,
  zone text not null,
  side text check (side in ('izquierda','derecha','bilateral','no_aplica')),
  title text not null,                                       -- descripción o diagnóstico
  eva_initial smallint check (eva_initial between 0 and 10), -- dolor al inicio (0-10)
  treating text,                                             -- tratante (nombre libre: kine, traumatólogo…)
  status text not null default 'activa' check (status in ('activa','rehabilitacion','alta')),
  discharge_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint injuries_alta_fecha check ((status = 'alta') = (discharge_date is not null)),
  constraint injuries_alta_orden check (discharge_date is null or discharge_date >= onset_date)
);
create index if not exists injuries_patient_idx on public.injuries (patient_id, onset_date desc);

-- 2) Dolor diario por lesión (EVA 0-10). Uno por lesión y día.
create table if not exists public.injury_pain_logs (
  id uuid primary key default gen_random_uuid(),
  injury_id uuid not null references public.injuries(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  log_date date not null,
  eva smallint not null check (eva between 0 and 10),
  note text,
  created_at timestamptz not null default now(),
  unique (injury_id, log_date)
);
create index if not exists injury_pain_logs_patient_idx on public.injury_pain_logs (patient_id, log_date desc);

-- 3) RLS
alter table public.injuries enable row level security;
alter table public.injury_pain_logs enable row level security;

drop policy if exists injuries_patient_all on public.injuries;
create policy injuries_patient_all on public.injuries for all
  using (patient_id = public.current_patient_id()) with check (patient_id = public.current_patient_id());
drop policy if exists injuries_admin_all on public.injuries;
create policy injuries_admin_all on public.injuries for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists injury_pain_patient_select on public.injury_pain_logs;
create policy injury_pain_patient_select on public.injury_pain_logs for select
  using (patient_id = public.current_patient_id());
-- Solo se registra dolor en una lesión propia y abierta (no dada de alta).
drop policy if exists injury_pain_patient_insert on public.injury_pain_logs;
create policy injury_pain_patient_insert on public.injury_pain_logs for insert
  with check (patient_id = public.current_patient_id() and exists (
    select 1 from public.injuries i where i.id = injury_id and i.patient_id = public.current_patient_id() and i.status <> 'alta'));
drop policy if exists injury_pain_patient_update on public.injury_pain_logs;
create policy injury_pain_patient_update on public.injury_pain_logs for update
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id() and exists (
    select 1 from public.injuries i where i.id = injury_id and i.patient_id = public.current_patient_id()));
drop policy if exists injury_pain_patient_delete on public.injury_pain_logs;
create policy injury_pain_patient_delete on public.injury_pain_logs for delete
  using (patient_id = public.current_patient_id());
drop policy if exists injury_pain_admin_all on public.injury_pain_logs;
create policy injury_pain_admin_all on public.injury_pain_logs for all using (public.is_admin()) with check (public.is_admin());

-- 4) Cada cambio de la lesión → entrada en la bitácora. Mantener en sincronía con describeChange() de assets/lesiones.js.
create or replace function public.injuries_to_journal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text := new.zone || case new.side when 'izquierda' then ' (lado izquierdo)' when 'derecha' then ' (lado derecho)' when 'bilateral' then ' (bilateral)' else '' end;
  v_title text; v_body text; v_changes text[] := '{}';
  v_author text := case when public.is_admin() then 'admin' when public.current_patient_id() = new.patient_id then 'paciente' else 'profesional' end;
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
-- BEFORE para fijar updated_at en la misma escritura; la entrada en journal_entries no depende del id final.
drop trigger if exists injuries_journal on public.injuries;
create trigger injuries_journal before insert or update on public.injuries
  for each row execute function public.injuries_to_journal();

-- 5) Lo que ve un profesional con permiso 'lesiones' sobre UNA persona. Registra el acceso.
create or replace function public.patient_lesiones(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null or not exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'lesiones' = any (l.scopes)) then
    raise exception 'sin permiso lesiones';
  end if;
  insert into public.access_log (professional_id, patient_id, scope) values (v_prof, p_patient, 'lesiones');
  return jsonb_build_object(
    'injuries', coalesce((select jsonb_agg(to_jsonb(i) order by i.onset_date desc) from public.injuries i where i.patient_id = p_patient), '[]'::jsonb),
    'pain', coalesce((select jsonb_agg(jsonb_build_object('injury_id', p.injury_id, 'log_date', p.log_date, 'eva', p.eva) order by p.log_date)
       from public.injury_pain_logs p where p.patient_id = p_patient and p.log_date >= current_date - 90), '[]'::jsonb));
end $$;

revoke all on function public.patient_lesiones(uuid) from public, anon;
grant execute on function public.patient_lesiones(uuid) to authenticated;
