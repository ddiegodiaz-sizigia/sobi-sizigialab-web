-- Mi equipo y permisos: la persona invita profesionales por correo, elige qué datos ve cada uno y ve quién accedió.
-- Ejecutar en Supabase > SQL Editor. Idempotente. Requiere 20261008_care_links.sql, 20261009_consent_texts.sql y 20261020.
-- Las tablas ya existen (professionals, care_links, access_log, consent_texts). Acá solo hay funciones y un texto nuevo.
-- La persona no lee la tabla professionals: solo nombre y rol de quienes están (o estuvieron) en su equipo, vía funciones.

-- 1) Invitar: busca el profesional por correo o lo crea sin cuenta. Él reclama la fila al entrar a equipo.html
--    con ese correo (claim_professional). Si el correo ya existe, se respeta el nombre y rol que tenía.
create or replace function public.invite_professional(p_email text, p_name text, p_role text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id(); v_email text := lower(trim(coalesce(p_email, ''))); v_id uuid;
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then raise exception 'correo invalido'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 or length(p_name) > 80 then raise exception 'nombre invalido'; end if;
  if p_role not in ('medico','entrenador','preparador','psicologo','nutricionista','kinesiologo','familia','otro') then raise exception 'rol invalido'; end if;
  select id into v_id from public.professionals where lower(email) = v_email;
  if v_id is null then
    insert into public.professionals (email, name, role) values (v_email, trim(p_name), p_role) returning id into v_id;
  end if;
  return v_id;
end $$;

-- 2) Conceder o cambiar permisos: misma firma que 20261009, ahora exige al menos un tipo de dato.
--    Cerrar el vínculo anterior y abrir uno nuevo deja historial de cada cambio con su versión de consentimiento.
create or replace function public.grant_care_link(p_professional uuid, p_scopes text[], p_consent_version text, p_accepted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id();
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if p_accepted is not true then raise exception 'falta aceptación explícita'; end if;
  if coalesce(cardinality(p_scopes), 0) = 0 then raise exception 'elige al menos un tipo de dato'; end if;
  if not exists (select 1 from public.consent_texts where version = p_consent_version) then raise exception 'versión de consentimiento inexistente'; end if;
  if not exists (select 1 from public.professionals where id = p_professional) then raise exception 'profesional inexistente'; end if;
  update public.care_links set revoked_at = now()
    where patient_id = v_patient and professional_id = p_professional and revoked_at is null;
  insert into public.care_links (patient_id, professional_id, scopes, consent_version, consent_accepted_at)
    values (v_patient, p_professional, p_scopes, p_consent_version, now());
end $$;

-- 3) Mi equipo: vínculos (activos e historial) con nombre, rol y si el profesional ya activó su cuenta.
create or replace function public.my_care_team() returns table (
  link_id uuid, professional_id uuid, name text, role text, email text, has_account boolean,
  scopes text[], consent_version text, granted_at timestamptz, revoked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, p.id, p.name, p.role, p.email, p.auth_user_id is not null, l.scopes, l.consent_version, l.granted_at, l.revoked_at
  from public.care_links l join public.professionals p on p.id = l.professional_id
  where l.patient_id = public.current_patient_id()
  order by l.granted_at desc
$$;

-- 4) Quién accedió a mis datos, con nombre y rol (la tabla professionals no es legible para la persona).
create or replace function public.my_access_log(p_limit int default 200) returns table (accessed_at timestamptz, name text, role text, scope text)
language sql stable security definer set search_path = public as $$
  select a.accessed_at, p.name, p.role, a.scope
  from public.access_log a join public.professionals p on p.id = a.professional_id
  where a.patient_id = public.current_patient_id()
  order by a.accessed_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
$$;

revoke all on function public.invite_professional(text, text, text), public.my_care_team(), public.my_access_log(int) from public, anon;
grant execute on function public.invite_professional(text, text, text), public.my_care_team(), public.my_access_log(int) to authenticated;
revoke all on function public.grant_care_link(uuid, text[], text, boolean) from public, anon;
grant execute on function public.grant_care_link(uuid, text[], text, boolean) to authenticated;

-- 5) Texto de consentimiento por tipo de dato. {{DATOS}} lo completa la app con la lista exacta elegida,
--    que queda guardada en care_links.scopes junto a esta versión. BORRADOR: requiere revisión legal (mismos [..] que v2).
insert into public.consent_texts (version, body, is_final) values ('v3-borrador', $body$**Quién es el responsable de tus datos.** Sizigia Lab SpA, RUT [RUT], domicilio [DOMICILIO]. Contacto de protección de datos: [CORREO].

**Qué datos y para qué.** Autorizas a {{PROFESIONAL}} ({{ROL}}) a ver solo estos datos tuyos, para acompañar tu salud y tu entrenamiento:
{{DATOS}}
No ve ningún otro dato. No se venden ni se usan para publicidad.

**Son datos de salud.** La ley los trata como datos sensibles y por eso te pedimos autorización explícita, dato por dato.

**Cálculo automático.** Si compartes el semáforo, este se calcula con reglas simples sobre tus registros. Sirve para conversar y no reemplaza el juicio de ningún profesional. Ninguna decisión sobre ti se toma solo con ese cálculo. Puedes oponerte a él.

**Quién más trata tus datos.** El equipo clínico de Sizigia Lab accede por su rol médico. Nuestro proveedor de infraestructura, [Supabase], los almacena en [REGIÓN/PAÍS]. [Si es fuera de Chile: transferencia internacional y su garantía.]

**Cuánto tiempo.** [PLAZO]. Después se eliminan o se anonimizan.

**Tus derechos.** Acceso, rectificación, supresión, oposición, portabilidad y bloqueo temporal. Los ejerces escribiendo a [CORREO]. Respondemos en hasta 30 días corridos, ampliables por otros 30 si hay complejidad. Si no estás conforme, puedes reclamar ante la Agencia de Protección de Datos Personales.

**Cambiar o retirar el permiso.** Cuando quieras, sin dar razones, en la pestaña Mi equipo. Se aplica al instante y no afecta tu atención. Ves cada consulta que se haga.$body$, false)
on conflict (version) do nothing;
