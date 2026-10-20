-- Caso: conversación del equipo alrededor de una persona (profesionales entre sí y con la persona), con trazabilidad.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008, 20261020, 20261022, 20261026.
-- Reglas (decisiones de Diego, 2026-10-20):
--   * Permiso nuevo 'equipo' en care_links: el profesional participa en el caso de esa persona.
--   * Cada hilo tiene un tema. Un profesional lee un mensaje solo si va dirigido a él (o lo escribió) Y hoy tiene
--     'equipo' + el permiso del tema ('general' no pide otro). Un mensaje nunca muestra más de lo que el lector puede ver.
--   * La persona ve completo lo que va dirigido a ella; de lo que es solo entre profesionales ve que existe
--     (fecha, quién, tema) pero no el contenido. Lo que pasa a la hoja de vida (journal_entries) sí lo ve.
--   * Nadie lee estas tablas directo, tampoco el admin (misma regla que salud mental). Todo pasa por funciones.
--   * Nada se borra: editar crea una versión nueva (misma root_id), retirar marca retracted_at y oculta el texto.
--     Lo que ya está en la hoja de vida no se edita ni se retira desde acá.
--   * case_recipients guarda quién podía leer cada mensaje al enviarlo.

-- 1) Permiso 'equipo'
alter table public.care_links drop constraint if exists care_links_scopes_check;
alter table public.care_links add constraint care_links_scopes_check
  check (scopes <@ array['semaforo','ciclo','lesiones','nutricion','examenes','salud_mental','bitacora','equipo']::text[]);

-- 2) Tablas
create table if not exists public.case_threads (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 120),
  topic text not null check (topic in ('general','semaforo','lesiones','examenes','nutricion','salud_mental','ciclo')),
  ref_kind text check (ref_kind in ('lesion','examen')),
  ref_id uuid,
  created_by_kind text not null check (created_by_kind in ('paciente','profesional')),
  created_by_professional uuid references public.professionals(id),
  created_at timestamptz not null default now(),
  check ((ref_kind is null) = (ref_id is null))
);
create index if not exists case_threads_patient_idx on public.case_threads (patient_id, created_at desc);

create table if not exists public.case_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.case_threads(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  root_id uuid not null,
  version integer not null default 1 check (version >= 1),
  author_kind text not null check (author_kind in ('paciente','profesional')),
  author_professional_id uuid references public.professionals(id),
  body text not null check (length(btrim(body)) between 1 and 4000),
  audience text not null check (audience in ('equipo','equipo_persona','directo')),
  patient_can_read boolean not null,
  journal_entry_id uuid references public.journal_entries(id) on delete set null,
  retracted_at timestamptz,
  created_at timestamptz not null default now(),
  check ((author_kind = 'profesional') = (author_professional_id is not null)),
  unique (root_id, version)
);
create index if not exists case_messages_patient_idx on public.case_messages (patient_id, created_at);
create index if not exists case_messages_thread_idx on public.case_messages (thread_id, created_at);

create table if not exists public.case_recipients (
  message_id uuid not null references public.case_messages(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  primary key (message_id, professional_id)
);
create index if not exists case_recipients_prof_idx on public.case_recipients (professional_id);

create table if not exists public.case_mentions (
  message_id uuid not null references public.case_messages(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  primary key (message_id, professional_id)
);

create table if not exists public.case_reads (
  id bigint generated always as identity primary key,
  message_id uuid not null references public.case_messages(id) on delete cascade,
  reader_professional uuid references public.professionals(id) on delete cascade,
  reader_patient boolean not null default false,
  read_at timestamptz not null default now(),
  check ((reader_professional is null) = reader_patient)
);
create unique index if not exists case_reads_uniq on public.case_reads (message_id, coalesce(reader_professional, '00000000-0000-0000-0000-000000000000'::uuid));

-- RLS activo y sin políticas: nadie lee ni escribe directo (tampoco admin). Solo las funciones de abajo.
alter table public.case_threads enable row level security;
alter table public.case_messages enable row level security;
alter table public.case_recipients enable row level security;
alter table public.case_mentions enable row level security;
alter table public.case_reads enable row level security;

-- 3) Auxiliares internas (no se exponen)
-- ¿Este profesional puede hoy leer el tema en el caso de esta persona?
create or replace function public.case_can_read_topic(p_prof uuid, p_patient uuid, p_topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.care_links l where l.professional_id = p_prof and l.patient_id = p_patient and l.revoked_at is null
    and 'equipo' = any (l.scopes) and (p_topic = 'general' or p_topic = any (l.scopes)))
$$;

-- Tema del caso → scope de la bitácora. Mantener en sincronía con journalScope() de assets/caso.js.
create or replace function public.case_journal_scope(p_topic text) returns text
language sql immutable set search_path = public as $$
  select case when p_topic in ('lesiones','examenes','nutricion','salud_mental','ciclo') then p_topic else 'bitacora' end
$$;

-- Un mensaje como JSON para quien lo lee. p_hidden: solo metadatos (la persona, mensajes entre profesionales).
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
      'unread', case when p_prof is null
        then m.author_kind <> 'paciente' and not exists (select 1 from public.case_reads x where x.message_id = m.id and x.reader_patient)
        else m.author_professional_id is distinct from p_prof and not exists (select 1 from public.case_reads x where x.message_id = m.id and x.reader_professional = p_prof) end)
  end
  from public.case_messages m left join public.professionals a on a.id = m.author_professional_id
  where m.id = p_id
$$;

-- Pasa un mensaje a la hoja de vida (journal_entries). La persona siempre lo ve ahí.
create or replace function public.case_to_journal(p_msg uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.case_messages; t public.case_threads; v_entry uuid;
begin
  if p_kind not in ('nota','consulta') then raise exception 'tipo de registro invalido'; end if;
  select * into m from public.case_messages where id = p_msg;
  select * into t from public.case_threads where id = m.thread_id;
  insert into public.journal_entries (patient_id, entry_date, kind, title, body, author_kind, author_professional_id, scope, visible_to_patient)
    values (m.patient_id, current_date, p_kind, t.title, m.body, m.author_kind, m.author_professional_id, public.case_journal_scope(t.topic), true)
    returning id into v_entry;
  update public.case_messages set journal_entry_id = v_entry where id = p_msg;
  return v_entry;
end $$;

revoke all on function public.case_can_read_topic(uuid, uuid, text), public.case_journal_scope(text),
  public.case_message_json(uuid, uuid, boolean), public.case_to_journal(uuid, text) from public, anon, authenticated;

-- 4) Escribir. p_thread null = hilo nuevo (p_title, p_topic y opcional p_ref_kind/p_ref_id).
--    p_audience: 'equipo' (solo profesionales; la persona no puede elegirlo), 'equipo_persona', 'directo' (p_to; un
--    profesional puede sumar a la persona con p_with_patient). p_mentions ⊆ destinatarios. p_journal_kind: null, 'nota' o 'consulta'.
create or replace function public.post_case_message(p_patient uuid, p_thread uuid, p_title text, p_topic text, p_ref_kind text, p_ref_id uuid,
  p_body text, p_audience text, p_to uuid[], p_with_patient boolean, p_mentions uuid[], p_journal_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_is_patient boolean := public.current_patient_id() is not distinct from p_patient and p_patient is not null;
  v_prof uuid := case when v_is_patient then null else public.current_professional_id() end;
  v_thread public.case_threads; v_topic text; v_team uuid[]; v_to uuid[] := coalesce(p_to, '{}'); v_recips uuid[]; v_pat boolean; v_id uuid := gen_random_uuid();
begin
  if not v_is_patient and v_prof is null then raise exception 'sin permiso equipo'; end if;
  if p_thread is not null then
    select * into v_thread from public.case_threads where id = p_thread and patient_id = p_patient;
    if not found then raise exception 'hilo inexistente'; end if;
    v_topic := v_thread.topic;
  else
    v_topic := p_topic;
    if v_topic is null or v_topic not in ('general','semaforo','lesiones','examenes','nutricion','salud_mental','ciclo') then raise exception 'tema invalido'; end if;
    if length(btrim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'titulo invalido'; end if;
  end if;
  if not v_is_patient and not public.case_can_read_topic(v_prof, p_patient, v_topic) then raise exception 'sin permiso equipo'; end if;
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'mensaje invalido'; end if;
  if p_journal_kind is not null and p_journal_kind not in ('nota','consulta') then raise exception 'tipo de registro invalido'; end if;

  -- Quiénes pueden leer este tema hoy (menos quien escribe)
  select coalesce(array_agg(distinct l.professional_id), '{}') into v_team from public.care_links l
    where l.patient_id = p_patient and l.revoked_at is null and 'equipo' = any (l.scopes) and (v_topic = 'general' or v_topic = any (l.scopes))
      and l.professional_id is distinct from v_prof;
  if p_audience = 'equipo' and not v_is_patient then v_recips := v_team; v_pat := false;
  elsif p_audience = 'equipo_persona' then v_recips := v_team; v_pat := true;
  elsif p_audience = 'directo' then
    select coalesce(array_agg(distinct x), '{}') into v_to from unnest(v_to) x;
    if exists (select 1 from unnest(v_to) x where not (x = any (v_team))) then raise exception 'destinatario sin permiso'; end if;
    v_recips := v_to; v_pat := v_is_patient or coalesce(p_with_patient, false);
    if cardinality(v_recips) = 0 and (v_is_patient or not v_pat) then raise exception 'elige a quien'; end if;
  else raise exception 'audiencia invalida'; end if;
  if cardinality(v_recips) = 0 and (v_is_patient or not v_pat) then raise exception 'nadie del equipo puede leer este tema'; end if;
  if exists (select 1 from unnest(coalesce(p_mentions, '{}')) x where not (x = any (v_recips))) then raise exception 'mencion fuera de destinatarios'; end if;

  if p_thread is null then
    if p_ref_kind is not null then
      if p_ref_kind = 'lesion' and (v_topic <> 'lesiones' or not exists (select 1 from public.injuries where id = p_ref_id and patient_id = p_patient)) then raise exception 'referencia invalida'; end if;
      if p_ref_kind = 'examen' and (v_topic <> 'examenes' or not exists (select 1 from public.documents where id = p_ref_id and patient_id = p_patient)) then raise exception 'referencia invalida'; end if;
      if p_ref_kind not in ('lesion','examen') then raise exception 'referencia invalida'; end if;
    end if;
    insert into public.case_threads (patient_id, title, topic, ref_kind, ref_id, created_by_kind, created_by_professional)
      values (p_patient, btrim(p_title), v_topic, p_ref_kind, case when p_ref_kind is null then null else p_ref_id end,
              case when v_is_patient then 'paciente' else 'profesional' end, v_prof)
      returning * into v_thread;
  end if;

  insert into public.case_messages (id, thread_id, patient_id, root_id, version, author_kind, author_professional_id, body, audience, patient_can_read)
    values (v_id, v_thread.id, p_patient, v_id, 1, case when v_is_patient then 'paciente' else 'profesional' end, v_prof, btrim(p_body), p_audience, v_pat);
  insert into public.case_recipients (message_id, professional_id) select v_id, x from unnest(v_recips) x;
  insert into public.case_mentions (message_id, professional_id) select distinct v_id, x from unnest(coalesce(p_mentions, '{}')) x;
  if p_journal_kind is not null then perform public.case_to_journal(v_id, p_journal_kind); end if;
  return v_id;
end $$;

-- Mensaje propio, última versión, no retirado y fuera de la hoja de vida. Devuelve la fila o lanza error.
create or replace function public.case_own_message(p_id uuid) returns public.case_messages
language plpgsql stable security definer set search_path = public as $$
declare m public.case_messages; v_prof uuid := public.current_professional_id();
begin
  select * into m from public.case_messages where id = p_id;
  if not found then raise exception 'mensaje inexistente'; end if;
  if not ((m.author_kind = 'paciente' and m.patient_id = public.current_patient_id())
       or (m.author_kind = 'profesional' and m.author_professional_id = v_prof
           and public.case_can_read_topic(v_prof, m.patient_id, (select topic from public.case_threads where id = m.thread_id)))) then
    raise exception 'sin permiso';
  end if;
  if exists (select 1 from public.case_messages n where n.root_id = m.root_id and n.version > m.version) then raise exception 'hay una version mas nueva'; end if;
  if m.retracted_at is not null then raise exception 'mensaje retirado'; end if;
  if m.journal_entry_id is not null then raise exception 'ya esta en la hoja de vida'; end if;
  return m;
end $$;
revoke all on function public.case_own_message(uuid) from public, anon, authenticated;

-- Editar: versión nueva con los mismos destinatarios y menciones. La anterior queda guardada.
create or replace function public.edit_case_message(p_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.case_messages := public.case_own_message(p_id); v_id uuid := gen_random_uuid();
begin
  if length(btrim(coalesce(p_body, ''))) not between 1 and 4000 then raise exception 'mensaje invalido'; end if;
  insert into public.case_messages (id, thread_id, patient_id, root_id, version, author_kind, author_professional_id, body, audience, patient_can_read)
    values (v_id, m.thread_id, m.patient_id, m.root_id, m.version + 1, m.author_kind, m.author_professional_id, btrim(p_body), m.audience, m.patient_can_read);
  insert into public.case_recipients (message_id, professional_id) select v_id, professional_id from public.case_recipients where message_id = m.id;
  insert into public.case_mentions (message_id, professional_id) select v_id, professional_id from public.case_mentions where message_id = m.id;
  return v_id;
end $$;

-- Retirar: oculta el texto de todas las versiones; las filas quedan.
create or replace function public.retract_case_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare m public.case_messages := public.case_own_message(p_id);
begin
  update public.case_messages set retracted_at = now() where root_id = m.root_id and retracted_at is null;
end $$;

-- Pasar a la hoja de vida un mensaje propio ya enviado.
create or replace function public.promote_case_message(p_id uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare m public.case_messages := public.case_own_message(p_id);
begin
  return public.case_to_journal(m.id, p_kind);
end $$;

-- 5) Leer (profesional): lo dirigido a él o escrito por él, si hoy puede leer el tema. Registra el acceso y marca leído.
create or replace function public.case_feed(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_prof uuid := public.current_professional_id(); v_ids uuid[]; v_out jsonb;
begin
  if v_prof is null or not exists (select 1 from public.care_links l where l.professional_id = v_prof and l.patient_id = p_patient
      and l.revoked_at is null and 'equipo' = any (l.scopes)) then
    raise exception 'sin permiso equipo';
  end if;
  insert into public.access_log (professional_id, patient_id, scope) values (v_prof, p_patient, 'equipo');
  select coalesce(array_agg(m.id), '{}') into v_ids from public.case_messages m join public.case_threads t on t.id = m.thread_id
    where m.patient_id = p_patient and public.case_can_read_topic(v_prof, p_patient, t.topic)
      and (m.author_professional_id = v_prof or exists (select 1 from public.case_recipients r where r.message_id = m.id and r.professional_id = v_prof));
  v_out := jsonb_build_object(
    'me', v_prof,
    'patient_name', (select name from public.patients where id = p_patient),
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role,
        'topics', (select jsonb_agg(t) from unnest(array['general','semaforo','lesiones','examenes','nutricion','salud_mental','ciclo']) t where t = 'general' or t = any (l.scopes))) order by p.name)
      from public.care_links l join public.professionals p on p.id = l.professional_id
      where l.patient_id = p_patient and l.revoked_at is null and 'equipo' = any (l.scopes)), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'topic', t.topic, 'ref_kind', t.ref_kind, 'ref_id', t.ref_id,
        'ref_label', case t.ref_kind when 'lesion' then (select i.zone || coalesce(' · ' || i.title, '') from public.injuries i where i.id = t.ref_id)
                                     when 'examen' then (select d.title from public.documents d where d.id = t.ref_id) end,
        'created_at', t.created_at) order by t.created_at)
      from public.case_threads t where t.id in (select thread_id from public.case_messages where id = any (v_ids))), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(public.case_message_json(m.id, v_prof, false) order by m.created_at)
      from public.case_messages m where m.id = any (v_ids)), '[]'::jsonb),
    -- Para enlazar un hilo nuevo con una lesión o un examen (solo si tiene ese permiso)
    'refs', jsonb_build_object(
      'lesion', case when public.case_can_read_topic(v_prof, p_patient, 'lesiones') then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.zone || coalesce(' · ' || i.title, '')) order by i.onset_date desc)
        from public.injuries i where i.patient_id = p_patient), '[]'::jsonb) else '[]'::jsonb end,
      'examen', case when public.case_can_read_topic(v_prof, p_patient, 'examenes') then coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.title || ' (' || to_char(d.doc_date, 'DD-MM-YYYY') || ')') order by d.doc_date desc)
        from public.documents d where d.patient_id = p_patient), '[]'::jsonb) else '[]'::jsonb end));
  insert into public.case_reads (message_id, reader_professional)
    select m.id, v_prof from public.case_messages m where m.id = any (v_ids) and m.author_professional_id is distinct from v_prof
    on conflict do nothing;
  return v_out;
end $$;

-- Leer (persona): completo lo dirigido a ella o escrito por ella; del resto, solo metadatos. Marca leído.
create or replace function public.my_case_feed() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pat uuid := public.current_patient_id(); v_out jsonb;
begin
  if v_pat is null then raise exception 'no es paciente'; end if;
  v_out := jsonb_build_object(
    'team', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role,
        'topics', (select jsonb_agg(t) from unnest(array['general','semaforo','lesiones','examenes','nutricion','salud_mental','ciclo']) t where t = 'general' or t = any (l.scopes))) order by p.name)
      from public.care_links l join public.professionals p on p.id = l.professional_id
      where l.patient_id = v_pat and l.revoked_at is null and 'equipo' = any (l.scopes)), '[]'::jsonb),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'topic', t.topic, 'created_at', t.created_at,
        'title', case when exists (select 1 from public.case_messages m where m.thread_id = t.id and (m.patient_can_read or m.author_kind = 'paciente')) then t.title end,
        'ref_kind', t.ref_kind, 'ref_id', t.ref_id,
        'ref_label', case t.ref_kind when 'lesion' then (select i.zone || coalesce(' · ' || i.title, '') from public.injuries i where i.id = t.ref_id)
                                     when 'examen' then (select d.title from public.documents d where d.id = t.ref_id) end) order by t.created_at)
      from public.case_threads t where t.patient_id = v_pat), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(public.case_message_json(m.id, null, not (m.patient_can_read or m.author_kind = 'paciente')) order by m.created_at)
      from public.case_messages m where m.patient_id = v_pat), '[]'::jsonb));
  insert into public.case_reads (message_id, reader_patient)
    select m.id, true from public.case_messages m where m.patient_id = v_pat and m.patient_can_read and m.author_kind <> 'paciente'
    on conflict do nothing;
  return v_out;
end $$;

-- 6) Sin leer, sin contenido (no registra acceso). Profesional: por persona, con menciones. Persona: un número.
create or replace function public.my_case_inbox() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'mentions')::int > 0 desc, x->>'last_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('patient_id', pt.id, 'patient_name', pt.name,
      'unread', count(*) filter (where not exists (select 1 from public.case_reads r where r.message_id = m.id and r.reader_professional = l.professional_id)),
      'mentions', count(*) filter (where exists (select 1 from public.case_mentions c where c.message_id = m.id and c.professional_id = l.professional_id)
                                     and not exists (select 1 from public.case_reads r where r.message_id = m.id and r.reader_professional = l.professional_id)),
      'last_at', max(m.created_at)) x
    from public.care_links l
    join public.patients pt on pt.id = l.patient_id
    join public.case_messages m on m.patient_id = l.patient_id
    join public.case_threads t on t.id = m.thread_id
    where l.professional_id = public.current_professional_id() and l.revoked_at is null and 'equipo' = any (l.scopes)
      and (t.topic = 'general' or t.topic = any (l.scopes))
      and exists (select 1 from public.case_recipients r where r.message_id = m.id and r.professional_id = l.professional_id)
      and m.retracted_at is null
      and not exists (select 1 from public.case_messages n where n.root_id = m.root_id and n.version > m.version)
    group by pt.id, pt.name
  ) s
$$;

create or replace function public.my_case_unread() returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.case_messages m
  where m.patient_id = public.current_patient_id() and m.patient_can_read and m.author_kind <> 'paciente' and m.retracted_at is null
    and not exists (select 1 from public.case_reads r where r.message_id = m.id and r.reader_patient)
    and not exists (select 1 from public.case_messages n where n.root_id = m.root_id and n.version > m.version)
$$;

revoke all on function public.post_case_message(uuid, uuid, text, text, text, uuid, text, text, uuid[], boolean, uuid[], text),
  public.edit_case_message(uuid, text), public.retract_case_message(uuid), public.promote_case_message(uuid, text),
  public.case_feed(uuid), public.my_case_feed(), public.my_case_inbox(), public.my_case_unread() from public, anon;
grant execute on function public.post_case_message(uuid, uuid, text, text, text, uuid, text, text, uuid[], boolean, uuid[], text),
  public.edit_case_message(uuid, text), public.retract_case_message(uuid), public.promote_case_message(uuid, text),
  public.case_feed(uuid), public.my_case_feed(), public.my_case_inbox(), public.my_case_unread() to authenticated;
