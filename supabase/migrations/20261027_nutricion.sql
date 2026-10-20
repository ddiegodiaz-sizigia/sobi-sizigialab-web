-- Nutrición: plan por comida (con historial de versiones), adherencia diaria por comida y lectura del profesional.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql, 20261020_bitacora_sexo_ciclo.sql y
-- la tabla measurements (peso y composición, pestaña Medidas): no se duplica, el profesional la lee por patient_nutricion().
-- El plan solo se escribe por set_nutrition_plan(): la persona, el admin o un profesional con vínculo activo y permiso
-- 'nutricion'. Cada versión queda guardada (el plan vigente es el último) y deja una entrada 'plan' en la bitácora.
-- La adherencia diaria no va a la bitácora (sería ruido). Se registra hasta 7 días hacia atrás.

-- 1) Planes. meals: [{key, name, time, guide}] (1 a 8 comidas). Nunca se edita una fila: cada cambio es una versión nueva.
create table if not exists public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  valid_from date not null default (now() at time zone 'America/Santiago')::date,
  meals jsonb not null check (jsonb_typeof(meals) = 'array' and jsonb_array_length(meals) between 1 and 8),
  notes text,
  author_kind text not null check (author_kind in ('paciente','profesional','admin')),
  author_professional_id uuid references public.professionals(id),
  created_at timestamptz not null default now()
);
create index if not exists nutrition_plans_patient_idx on public.nutrition_plans (patient_id, created_at desc);

-- 2) Adherencia: una fila por persona, día y comida. status: 2 cumplí, 1 parcial, 0 no.
create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  log_date date not null,
  meal_key text not null,
  status smallint not null check (status in (0, 1, 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (patient_id, log_date, meal_key)
);
create index if not exists meal_logs_patient_idx on public.meal_logs (patient_id, log_date desc);

-- 3) RLS
alter table public.nutrition_plans enable row level security;
alter table public.meal_logs enable row level security;
drop policy if exists nutrition_plans_patient_select on public.nutrition_plans;
create policy nutrition_plans_patient_select on public.nutrition_plans for select using (patient_id = public.current_patient_id());
drop policy if exists nutrition_plans_admin_select on public.nutrition_plans;
create policy nutrition_plans_admin_select on public.nutrition_plans for select using (public.is_admin());

drop policy if exists meal_logs_patient_select on public.meal_logs;
create policy meal_logs_patient_select on public.meal_logs for select using (patient_id = public.current_patient_id());
-- Solo sobre un plan propio y dentro de los últimos 7 días (sin fechas futuras).
drop policy if exists meal_logs_patient_insert on public.meal_logs;
create policy meal_logs_patient_insert on public.meal_logs for insert
  with check (patient_id = public.current_patient_id() and log_date between current_date - 7 and current_date
    and exists (select 1 from public.nutrition_plans p where p.id = plan_id and p.patient_id = public.current_patient_id()));
drop policy if exists meal_logs_patient_update on public.meal_logs;
create policy meal_logs_patient_update on public.meal_logs for update
  using (patient_id = public.current_patient_id())
  with check (patient_id = public.current_patient_id() and log_date between current_date - 7 and current_date
    and exists (select 1 from public.nutrition_plans p where p.id = plan_id and p.patient_id = public.current_patient_id()));
drop policy if exists meal_logs_patient_delete on public.meal_logs;
create policy meal_logs_patient_delete on public.meal_logs for delete using (patient_id = public.current_patient_id());
drop policy if exists meal_logs_admin_select on public.meal_logs;
create policy meal_logs_admin_select on public.meal_logs for select using (public.is_admin());

-- 4) Guardar una versión nueva del plan. Texto de la bitácora igual a planJournal() de assets/nutricion.js.
create or replace function public.set_nutrition_plan(p_patient uuid, p_meals jsonb, p_notes text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := public.is_admin();
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
revoke all on function public.set_nutrition_plan(uuid, jsonb, text) from public, anon;
grant execute on function public.set_nutrition_plan(uuid, jsonb, text) to authenticated;

-- 5) Lo que ve un profesional con permiso 'nutricion' sobre UNA persona. Registra el acceso.
create or replace function public.patient_nutricion(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id();
begin
  if v_prof is null or not exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'nutricion' = any (l.scopes)) then
    raise exception 'sin permiso nutricion';
  end if;
  insert into public.access_log (professional_id, patient_id, scope) values (v_prof, p_patient, 'nutricion');
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'valid_from', p.valid_from, 'meals', p.meals, 'notes', p.notes,
        'author_kind', p.author_kind, 'created_at', p.created_at) order by p.created_at desc) from public.nutrition_plans p where p.patient_id = p_patient), '[]'::jsonb),
    'logs', coalesce((select jsonb_agg(jsonb_build_object('plan_id', g.plan_id, 'log_date', g.log_date, 'meal_key', g.meal_key, 'status', g.status) order by g.log_date)
      from public.meal_logs g where g.patient_id = p_patient and g.log_date >= current_date - 90), '[]'::jsonb),
    'body', coalesce((select jsonb_agg(jsonb_build_object('entry_date', x.entry_date, 'weight_kg', x.weight_kg, 'body_fat_pct', x.body_fat_pct,
        'muscle_mass_kg', x.muscle_mass_kg) order by x.entry_date) from public.measurements x where x.patient_id = p_patient and x.entry_date >= current_date - 365), '[]'::jsonb));
end $$;
revoke all on function public.patient_nutricion(uuid) from public, anon;
grant execute on function public.patient_nutricion(uuid) to authenticated;
