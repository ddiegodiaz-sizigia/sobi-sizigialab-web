-- Registro de persona común: energía, sueño, estrés y hábitos, sin RPE ni minutos de sesión. Diario o semanal.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql y 20261020_bitacora_sexo_ciclo.sql.
-- Convive con athlete_logs: cada persona usa UN tipo de registro (log_settings.mode). 'deportivo' (por defecto, nada cambia
-- para quien ya registra) o 'comun'. El semáforo del registro común está en assets/semaforo.js (SEM_RULES_COMUN).
-- Quién configura: la persona, el admin o un profesional con vínculo activo y permiso 'semaforo' (vía set_log_settings).
-- Cada cambio de configuración deja una entrada 'plan' en la hoja de vida. Los registros diarios/semanales no van a la bitácora.

-- 1) Configuración del registro, una fila por persona. Sin fila = deportivo diario.
create table if not exists public.log_settings (
  patient_id uuid primary key references public.patients(id) on delete cascade,
  mode text not null default 'deportivo' check (mode in ('deportivo','comun')),
  frequency text not null default 'diaria' check (frequency in ('diaria','semanal')),
  habits text[] not null default '{}' check (cardinality(habits) <= 8),
  set_by text not null default 'paciente' check (set_by in ('paciente','profesional','admin')),
  set_by_professional uuid references public.professionals(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint log_settings_deportivo_diario check (mode = 'comun' or frequency = 'diaria')
);

-- 2) Registro general. Diario: log_date = el día. Semanal: log_date = lunes de la semana, valores = promedio de la semana.
--    habits: {"Caminar 30 min": 1} en el diario (0 o 1), {"Caminar 30 min": 4} en el semanal (días de 0 a 7).
create table if not exists public.wellness_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  period text not null check (period in ('dia','semana')),
  log_date date not null,
  energy smallint check (energy between 1 and 10),             -- 10 = mucha energía
  sleep_hours numeric(3,1) check (sleep_hours between 0 and 16),
  sleep_quality smallint check (sleep_quality between 1 and 10),
  stress smallint check (stress between 1 and 10),             -- 10 = muy estresado
  habits jsonb not null default '{}' check (jsonb_typeof(habits) = 'object'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, period, log_date),
  constraint wellness_semana_lunes check (period = 'dia' or extract(isodow from log_date) = 1)
);
create index if not exists wellness_logs_patient_idx on public.wellness_logs (patient_id, log_date desc);

-- 3) RLS. La persona: todo lo suyo en wellness_logs; solo lee su configuración (escribe por la función).
--    Admin: solo lectura, igual que athlete_logs (ver bloqueante multi-tenant). Profesionales: solo por coach_feed_v2().
alter table public.log_settings enable row level security;
alter table public.wellness_logs enable row level security;

drop policy if exists log_settings_patient_select on public.log_settings;
create policy log_settings_patient_select on public.log_settings for select using (patient_id = public.current_patient_id());
drop policy if exists log_settings_admin_select on public.log_settings;
create policy log_settings_admin_select on public.log_settings for select using (public.is_admin());

drop policy if exists wellness_logs_patient_all on public.wellness_logs;
create policy wellness_logs_patient_all on public.wellness_logs for all
  using (patient_id = public.current_patient_id()) with check (patient_id = public.current_patient_id());
drop policy if exists wellness_logs_admin_select on public.wellness_logs;
create policy wellness_logs_admin_select on public.wellness_logs for select using (public.is_admin());

-- 4) Configurar el registro. p_patient null = uno mismo. Mantener el texto de la bitácora en sincronía con
--    settingsSummary() de assets/registro-comun.js.
create or replace function public.set_log_settings(p_patient uuid, p_mode text, p_frequency text, p_habits text[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_patient uuid := coalesce(p_patient, public.current_patient_id());
  v_prof uuid := public.current_professional_id();
  v_by text; v_prof_name text; v_freq text; v_habits text[]; v_old public.log_settings;
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if v_patient = public.current_patient_id() then v_by := 'paciente';
  elsif public.is_admin() then v_by := 'admin';
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

-- 5) Lo que ve un profesional con permiso 'semaforo': tipo de registro y registros (sin notas libres) de cada persona
--    con vínculo activo. Reemplaza a coach_feed() en equipo.html; coach_feed() queda por compatibilidad. Un acceso por persona.
create or replace function public.coach_feed_v2() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null then return '[]'::jsonb; end if;
  insert into public.access_log (professional_id, patient_id, scope)
    select v_prof, l.patient_id, 'semaforo' from public.care_links l
    where l.professional_id = v_prof and l.revoked_at is null and 'semaforo' = any (l.scopes);
  return coalesce((select jsonb_agg(jsonb_build_object(
      'patient_id', pt.id, 'patient_name', pt.name,
      'mode', coalesce(s.mode, 'deportivo'), 'frequency', coalesce(s.frequency, 'diaria'), 'habits', coalesce(s.habits, '{}'),
      'athlete', coalesce((select jsonb_agg(jsonb_build_object('log_date', a.log_date, 'sleep_hours', a.sleep_hours, 'sleep_quality', a.sleep_quality,
          'fatigue', a.fatigue, 'mood', a.mood, 'pain_level', a.pain_level, 'pain_zone', a.pain_zone, 'trained', a.trained,
          'session_rpe', a.session_rpe, 'session_minutes', a.session_minutes) order by a.log_date)
        from public.athlete_logs a where a.patient_id = pt.id and a.log_date >= current_date - 60), '[]'::jsonb),
      'wellness', coalesce((select jsonb_agg(jsonb_build_object('period', w.period, 'log_date', w.log_date, 'energy', w.energy,
          'sleep_hours', w.sleep_hours, 'sleep_quality', w.sleep_quality, 'stress', w.stress, 'habits', w.habits) order by w.log_date)
        from public.wellness_logs w where w.patient_id = pt.id and w.log_date >= current_date - 90), '[]'::jsonb)
    ) order by pt.name)
    from public.care_links l
    join public.patients pt on pt.id = l.patient_id
    left join public.log_settings s on s.patient_id = pt.id
    where l.professional_id = v_prof and l.revoked_at is null and 'semaforo' = any (l.scopes)), '[]'::jsonb);
end $$;

revoke all on function public.set_log_settings(uuid, text, text, text[]), public.coach_feed_v2() from public, anon;
grant execute on function public.set_log_settings(uuid, text, text, text[]), public.coach_feed_v2() to authenticated;
