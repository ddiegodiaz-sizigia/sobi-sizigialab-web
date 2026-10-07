// Pruebas de las políticas RLS y funciones de roles. Corre Postgres en memoria (PGlite), sin tocar Supabase.
// Uso: npm i --no-save @electric-sql/pglite && node supabase/tests/roles_rls.test.mjs
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const dir = path.dirname(fileURLToPath(import.meta.url));
const mig = f => readFileSync(path.join(dir, '..', 'migrations', f), 'utf8');

const db = new PGlite();
// Entorno mínimo que Supabase ya trae: roles, auth.uid()/auth.jwt(), patients, admins, is_admin().
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create table public.patients (id uuid primary key default gen_random_uuid(), name text, email text, auth_user_id uuid, phone text);
  create table public.admins (email text primary key);
  create function public.is_admin() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
  -- SUPUESTO: patients ya tiene RLS (propio + admin). Verificar contra las políticas reales de Supabase: el repo no las versiona.
  alter table public.patients enable row level security;
  create policy patients_own on public.patients for select using (auth_user_id = auth.uid());
  create policy patients_admin on public.patients for select using (public.is_admin());
  grant usage on schema public, auth to anon, authenticated;
  grant all on all tables in schema public to anon, authenticated;
`);
await db.exec(mig('20261007_athlete_logs.sql'));
await db.exec(mig('20261008_care_links.sql'));
await db.exec('grant all on all tables in schema public to anon, authenticated; grant usage on all sequences in schema public to anon, authenticated;');

const U = { A: '00000000-0000-0000-0000-00000000000a', B: '00000000-0000-0000-0000-00000000000b', C: '00000000-0000-0000-0000-00000000000c', D: '00000000-0000-0000-0000-00000000000d', ADM: '00000000-0000-0000-0000-0000000000ad' };
await db.exec(`
  insert into public.admins values ('manuel@x.cl');
  insert into public.patients (id,name,email,auth_user_id) values
    ('10000000-0000-0000-0000-00000000000a','Paciente A','a@x.cl','${U.A}'),
    ('10000000-0000-0000-0000-00000000000b','Paciente B','b@x.cl','${U.B}');
  insert into public.athlete_logs (patient_id, log_date, sleep_hours, fatigue, pain_level, pain_zone, notes) values
    ('10000000-0000-0000-0000-00000000000a', current_date, 6, 5, 2, 'Rodilla', 'nota privada A'),
    ('10000000-0000-0000-0000-00000000000b', current_date, 7, 3, 0, null, 'nota privada B');
`);

async function as(who, email, fn) {            // who: uuid o null (anon)
  await db.exec(`reset role; select set_config('request.jwt.claims', '${who ? JSON.stringify({ sub: who, email }) : ''}', false); set role ${who ? 'authenticated' : 'anon'};`);
  try { return await fn(); } finally { await db.exec('reset role;'); }
}
const q = async (sql, p) => (await db.query(sql, p)).rows;
const fails = async (sql) => { try { await db.query(sql); return false; } catch { return true; } };
let ok = 0, bad = 0;
const t = (name, cond) => { cond ? ok++ : bad++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// Admin crea profesionales; un no-admin no puede.
await as(U.ADM, 'manuel@x.cl', async () => {
  await db.query(`insert into public.professionals (email,name,role) values ('coach@x.cl','Coach C','entrenador'), ('otro@x.cl','Coach D','preparador')`);
});
t('admin crea profesionales', (await q(`select count(*)::int n from public.professionals`))[0].n === 2);
t('paciente no puede crear profesionales', await as(U.A, 'a@x.cl', () => fails(`insert into public.professionals (email,name,role) values ('hack@x.cl','H','medico')`)));

// El profesional reclama su fila.
t('profesional reclama su fila por email', await as(U.C, 'coach@x.cl', async () => (await q(`select public.claim_professional() ok`))[0].ok === true));
t('profesional con email desconocido no reclama', await as(U.D, 'nadie@x.cl', async () => (await q(`select public.claim_professional() ok`))[0].ok === false));
await as(U.D, 'otro@x.cl', () => db.query(`select public.claim_professional()`));

const coach = () => as(U.C, 'coach@x.cl', async () => ({
  feed: await q(`select * from public.coach_feed()`),
  logsDirect: await q(`select * from public.athlete_logs`),
  patientsDirect: await q(`select * from public.patients`),
  linksDirect: await q(`select * from public.care_links`)
}));

// Sin vínculo: no ve nada.
let r = await coach();
t('sin vínculo: coach_feed vacío', r.feed.length === 0);
t('sin vínculo: no lee athlete_logs directo', r.logsDirect.length === 0);
t('sin vínculo: no lee patients directo', r.patientsDirect.length === 0);
t('sin vínculo: sin registro de acceso', (await q(`select count(*)::int n from public.access_log`))[0].n === 0);

// Paciente A concede. Paciente B no.
const proIdC = (await q(`select id from public.professionals where email='coach@x.cl'`))[0].id;
await as(U.A, 'a@x.cl', () => db.query(`select public.grant_care_link($1, array['semaforo'])`, [proIdC]));
r = await coach();
t('con vínculo: ve solo a A', r.feed.length === 1 && r.feed[0].patient_name === 'Paciente A');
t('con vínculo: el feed no incluye notas libres', !('notes' in r.feed[0]));
t('con vínculo: sigue sin leer athlete_logs directo (notas)', r.logsDirect.length === 0);
t('con vínculo: sigue sin leer patients directo', r.patientsDirect.length === 0);
t('el coach ve su propio vínculo', r.linksDirect.length === 1);
t('se registró el acceso a A', (await q(`select count(*)::int n from public.access_log where patient_id='10000000-0000-0000-0000-00000000000a'`))[0].n >= 1);
t('no hay acceso registrado a B', (await q(`select count(*)::int n from public.access_log where patient_id='10000000-0000-0000-0000-00000000000b'`))[0].n === 0);

// Transparencia: A ve quién accedió; B no ve lo de A.
t('A ve su registro de accesos', await as(U.A, 'a@x.cl', async () => (await q(`select * from public.access_log`)).length >= 1));
t('B no ve accesos de A', await as(U.B, 'b@x.cl', async () => (await q(`select * from public.access_log`)).length === 0));
t('B no ve vínculos de A', await as(U.B, 'b@x.cl', async () => (await q(`select * from public.care_links`)).length === 0));

// Escrituras directas bloqueadas.
t('coach no inserta vínculos directo', await as(U.C, 'coach@x.cl', () => fails(`insert into public.care_links (patient_id, professional_id, scopes) values ('10000000-0000-0000-0000-00000000000b','${proIdC}','{semaforo}')`)));
t('coach no inserta access_log directo', await as(U.C, 'coach@x.cl', () => fails(`insert into public.access_log (professional_id, patient_id, scope) values ('${proIdC}','10000000-0000-0000-0000-00000000000b','semaforo')`)));
t('paciente no inserta vínculos directo', await as(U.B, 'b@x.cl', () => fails(`insert into public.care_links (patient_id, professional_id, scopes) values ('10000000-0000-0000-0000-00000000000b','${proIdC}','{semaforo}')`)));
t('scope inválido rechazado', await as(U.B, 'b@x.cl', () => fails(`select public.grant_care_link('${proIdC}', array['notas_clinicas'])`)));
t('coach no puede conceder permisos (no es paciente)', await as(U.C, 'coach@x.cl', () => fails(`select public.grant_care_link('${proIdC}', array['semaforo'])`)));

// Un paciente solo concede sobre sí mismo: B concede y el feed muestra a B sin tocar a A.
await as(U.B, 'b@x.cl', () => db.query(`select public.grant_care_link($1, array['semaforo'])`, [proIdC]));
r = await coach();
t('tras segunda concesión ve A y B', new Set(r.feed.map(x => x.patient_name)).size === 2);

// Otro profesional no ve lo de C.
t('otro profesional no ve pacientes ajenos', await as(U.D, 'otro@x.cl', async () => (await q(`select * from public.coach_feed()`)).length === 0));
t('otro profesional no ve vínculos de C', await as(U.D, 'otro@x.cl', async () => (await q(`select * from public.care_links`)).length === 0));
t('paciente no obtiene datos por coach_feed', await as(U.A, 'a@x.cl', async () => (await q(`select * from public.coach_feed()`)).length === 0));

// Revocación inmediata.
await as(U.A, 'a@x.cl', () => db.query(`select public.revoke_care_link($1)`, [proIdC]));
r = await coach();
t('tras revocar: coach ya no ve a A', !r.feed.some(x => x.patient_name === 'Paciente A') && r.feed.some(x => x.patient_name === 'Paciente B'));

// Anónimo no ejecuta funciones.
t('anon no ejecuta coach_feed', await as(null, '', () => fails(`select * from public.coach_feed()`)));
t('anon no ejecuta list_professionals', await as(null, '', () => fails(`select * from public.list_professionals()`)));

// Lista de profesionales solo para pacientes.
t('paciente lista profesionales', await as(U.A, 'a@x.cl', async () => (await q(`select * from public.list_professionals()`)).length === 2));
t('coach no lista profesionales', await as(U.C, 'coach@x.cl', async () => (await q(`select * from public.list_professionals()`)).length === 0));

// athlete_logs: paciente solo ve lo suyo.
t('paciente A ve solo sus logs', await as(U.A, 'a@x.cl', async () => { const x = await q(`select * from public.athlete_logs`); return x.length === 1 && x[0].notes === 'nota privada A'; }));
t('admin lee athlete_logs', await as(U.ADM, 'manuel@x.cl', async () => (await q(`select * from public.athlete_logs`)).length === 2));

console.log(`\n${ok} pasan, ${bad} fallan`);
process.exit(bad ? 1 : 0);
