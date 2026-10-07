-- Consentimiento versionado: el texto que el atleta lee queda guardado y cada permiso apunta a la versión aceptada.
-- Requiere 20261008_care_links.sql. Idempotente. Los textos son inmutables: un cambio = una versión nueva.
-- BORRADOR: los corchetes [..] deben completarse y el texto revisarse con un abogado antes de usarlo con atletas reales.
-- Para publicar la versión final: insertar una fila nueva con is_final = true. La app siempre usa la más reciente.

create table if not exists public.consent_texts (
  version text primary key,
  body text not null,
  is_final boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.consent_texts enable row level security;
drop policy if exists consent_texts_read on public.consent_texts;
create policy consent_texts_read on public.consent_texts for select to authenticated using (true);
drop policy if exists consent_texts_admin_write on public.consent_texts;
create policy consent_texts_admin_write on public.consent_texts for all using (public.is_admin()) with check (public.is_admin());

alter table public.care_links add column if not exists consent_accepted_at timestamptz;

insert into public.consent_texts (version, body, is_final) values ('v2-borrador', $body$**Quién es el responsable de tus datos.** Sizigia Lab SpA, RUT [RUT], domicilio [DOMICILIO]. Contacto de protección de datos: [CORREO].

**Qué datos y para qué.** Tu registro deportivo diario: sueño, fatiga, ánimo, dolor y zona, y carga de entrenamiento. Se usan solo para que {{PROFESIONAL}} ({{ROL}}) ajuste tu carga y tu recuperación. No se venden ni se usan para publicidad. No incluye tus notas, check-ins, mediciones, exámenes ni sesiones.

**Son datos de salud.** La ley los trata como datos sensibles y por eso te pedimos autorización explícita.

**Cálculo automático.** Un semáforo verde, amarillo o rojo se calcula automáticamente con reglas simples sobre tus datos. Sirve para conversar antes de entrenar y no reemplaza el juicio de ningún profesional. Ninguna decisión sobre ti se toma solo con ese cálculo. Puedes oponerte a él.

**Quién más trata tus datos.** El equipo clínico de Sizigia Lab accede por su rol médico. Nuestro proveedor de infraestructura, [Supabase], los almacena en [REGIÓN/PAÍS]. [Si es fuera de Chile: transferencia internacional y su garantía.]

**Cuánto tiempo.** [PLAZO]. Después se eliminan o se anonimizan.

**Tus derechos.** Acceso, rectificación, supresión, oposición, portabilidad y bloqueo temporal. Los ejerces escribiendo a [CORREO]. Respondemos en hasta 30 días corridos, ampliables por otros 30 si hay complejidad. Si no estás conforme, puedes reclamar ante la Agencia de Protección de Datos Personales.

**Retirar el permiso.** Cuando quieras, sin dar razones, en Mi Data > Mi equipo y permisos. Se aplica al instante y no afecta tu atención. Ves cada consulta que se haga.$body$, false)
on conflict (version) do nothing;

-- Nueva firma: exige aceptación explícita y una versión de texto existente. Conserva el historial:
-- si ya había un permiso activo, se cierra y se crea uno nuevo con la versión aceptada.
drop function if exists public.grant_care_link(uuid, text[]);

create or replace function public.grant_care_link(p_professional uuid, p_scopes text[], p_consent_version text, p_accepted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_patient uuid := public.current_patient_id();
begin
  if v_patient is null then raise exception 'no es paciente'; end if;
  if p_accepted is not true then raise exception 'falta aceptación explícita'; end if;
  if not exists (select 1 from public.consent_texts where version = p_consent_version) then raise exception 'versión de consentimiento inexistente'; end if;
  if not exists (select 1 from public.professionals where id = p_professional) then raise exception 'profesional inexistente'; end if;
  update public.care_links set revoked_at = now()
    where patient_id = v_patient and professional_id = p_professional and revoked_at is null;
  insert into public.care_links (patient_id, professional_id, scopes, consent_version, consent_accepted_at)
    values (v_patient, p_professional, p_scopes, p_consent_version, now());
end $$;

revoke all on function public.grant_care_link(uuid, text[], text, boolean) from public, anon;
grant execute on function public.grant_care_link(uuid, text[], text, boolean) to authenticated;
