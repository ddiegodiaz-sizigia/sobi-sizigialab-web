-- Panel del coach (equipo.html): marcar a quién ya se contactó, para que sus pendientes se limpien.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql y 20261024_registro_comun.sql.
-- coach_contacts es el registro de trabajo del profesional: no guarda datos de salud ni el texto del mensaje, solo
-- a quién, cuándo y con qué plantilla. El mensaje sale por WhatsApp desde el teléfono del coach (wa.me sin número:
-- el coach elige el contacto), así que el teléfono de la persona no se expone al profesional.
-- Las plantillas válidas son las de TEMPLATES en assets/panel-coach.js: mantener en sincronía.

create table if not exists public.coach_contacts (
  id bigint generated always as identity primary key,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  template text not null check (template in ('recordatorio','alerta','constancia','habitos','otro')),
  contacted_at timestamptz not null default now()
);
create index if not exists coach_contacts_prof_idx on public.coach_contacts (professional_id, patient_id, contacted_at desc);

-- RLS: el profesional lee lo suyo; el admin solo lee. Se escribe solo por mark_contacted().
alter table public.coach_contacts enable row level security;
drop policy if exists coach_contacts_professional_select on public.coach_contacts;
create policy coach_contacts_professional_select on public.coach_contacts for select using (professional_id = public.current_professional_id());
drop policy if exists coach_contacts_admin_select on public.coach_contacts;
create policy coach_contacts_admin_select on public.coach_contacts for select using (public.is_admin());

-- Marcar contactado. Exige vínculo activo con permiso 'semaforo' (el mismo que da acceso al panel).
create or replace function public.mark_contacted(p_patient uuid, p_template text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id(); v_at timestamptz;
begin
  if v_prof is null then raise exception 'no es profesional'; end if;
  if not exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'semaforo' = any (l.scopes)) then raise exception 'sin permiso'; end if;
  if p_template not in ('recordatorio','alerta','constancia','habitos','otro') then raise exception 'plantilla invalida'; end if;
  insert into public.coach_contacts (professional_id, patient_id, template) values (v_prof, p_patient, p_template)
    returning contacted_at into v_at;
  return v_at;
end $$;

-- coach_feed_v2(): igual que en 20261024 más last_contact (último contacto de ESTE profesional con la persona).
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
        from public.wellness_logs w where w.patient_id = pt.id and w.log_date >= current_date - 90), '[]'::jsonb),
      'last_contact', (select jsonb_build_object('at', c.contacted_at, 'template', c.template) from public.coach_contacts c
        where c.professional_id = v_prof and c.patient_id = pt.id order by c.contacted_at desc limit 1)
    ) order by pt.name)
    from public.care_links l
    join public.patients pt on pt.id = l.patient_id
    left join public.log_settings s on s.patient_id = pt.id
    where l.professional_id = v_prof and l.revoked_at is null and 'semaforo' = any (l.scopes)), '[]'::jsonb);
end $$;

revoke all on function public.mark_contacted(uuid, text), public.coach_feed_v2() from public, anon;
grant execute on function public.mark_contacted(uuid, text), public.coach_feed_v2() to authenticated;
