import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL('../supabase/migrations/' + f, import.meta.url), 'utf8');
const ORG = '20261101_organizaciones.sql';
const sql = read(ORG);
const PREVIOUS = ['20261007_athlete_logs.sql', '20261008_care_links.sql', '20261009_consent_texts.sql', '20261020_bitacora_sexo_ciclo.sql',
  '20261021_set_my_profile.sql', '20261022_lesiones.sql', '20261023_mi_equipo.sql', '20261024_registro_comun.sql', '20261025_panel_coach.sql',
  '20261026_examenes.sql', '20261027_nutricion.sql', '20261028_ficha_profesional.sql', '20261029_caso_equipo.sql', '20261030_linea_tiempo.sql',
  '20261031_adjuntos.sql'];
// Políticas de admin creadas antes de que el esquema estuviera en el repo (leídas de pg_policies el 2026-10-21).
const LEGACY = ['checkins_admin_read', 'measurements_admin_read', 'patient_exams_admin_all', 'patient_logins_admin_all', 'patient_objectives_admin_all',
  'patients_admin_all', 'program_days_admin_all', 'templates_admin_all', 'transcripts_admin_all'];

// 1) Toda política que usaba is_admin() se reemplaza en esta migración
const adminPolicies = new Set(LEGACY);
for (const f of PREVIOUS) for (const m of read(f).matchAll(/create policy (\w+) on [\w.]+[^;]*?is_admin\(\)/g)) adminPolicies.add(m[1]);
assert.ok(adminPolicies.size >= 25, 'se encontraron las políticas de admin');
const dropped = new Set([...sql.matchAll(/drop policy if exists (\w+)/g)].map(m => m[1]));
const loop = sql.slice(sql.indexOf('foreach r slice 1'), sql.indexOf('end loop;'));
for (const m of loop.matchAll(/\['\w+','(\w+)','(?:select|all)'\]/g)) dropped.add(m[1]);
for (const p of adminPolicies) assert.ok(dropped.has(p), 'falta reemplazar la política ' + p);

// 2) Ninguna política nueva usa is_admin() (admin de cualquier organización)
for (const m of sql.matchAll(/create policy[^;]*;/g)) assert.ok(!/\bis_admin\(\)/.test(m[0]), 'política con is_admin(): ' + m[0].slice(0, 60));
assert.match(loop, /using \(public\.is_patient_admin\(patient_id\)\)%s/);
assert.match(loop, /with check \(public\.is_patient_admin\(patient_id\)\)/);

// 3) Toda función cuyo cuerpo vigente usa is_admin() se redefine aquí sin él
const fnBody = (text, name) => {
  const i = text.lastIndexOf('create or replace function public.' + name + '(');
  if (i < 0) return null;
  const open = text.indexOf('$$', i) + 2;
  return text.slice(i, text.indexOf('$$', open));
};
const adminFns = new Set();
for (const f of PREVIOUS) for (const m of read(f).matchAll(/create or replace function public\.(\w+)\(/g)) {
  const latest = PREVIOUS.map(g => fnBody(read(g), m[1])).filter(Boolean).pop();
  if (/\bis_admin\(\)/.test(latest)) adminFns.add(m[1]);
}
assert.deepEqual([...adminFns].sort(), ['delete_document', 'injuries_to_journal', 'save_document', 'set_log_settings', 'set_nutrition_plan']);
for (const f of adminFns) {
  const body = fnBody(sql, f);
  assert.ok(body, 'falta redefinir ' + f);
  assert.ok(!/\bis_admin\(\)/.test(body), f + ' sigue usando is_admin()');
  assert.match(body, /is_patient_admin\((p_patient|v_patient|new\.patient_id|v_doc\.patient_id)\)/, f + ' revisa a la persona');
}
// El resto del cuerpo no cambia: misma función de origen salvo la línea del admin
for (const [f, file, n] of [['set_nutrition_plan', '20261027_nutricion.sql', 1], ['save_document', '20261026_examenes.sql', 2],
  ['set_log_settings', '20261024_registro_comun.sql', 1], ['case_own_message', '20261029_caso_equipo.sql', 2]]) {
  const a = fnBody(read(file), f).split(/\r?\n/), b = fnBody(sql, f).split(/\r?\n/);
  assert.equal(a.length, b.length, f + ': mismo largo');
  assert.equal(a.filter((l, i) => l !== b[i]).length, n, f + ': cambian ' + n + ' líneas');
}

// 3b) Quien no es paciente: current_patient_id() es null y "not (false or null)" no lanzaba el error
assert.match(fnBody(sql, 'save_document'), /not \(v_admin or coalesce\(p_patient = public\.current_patient_id\(\), false\)\)/);
assert.match(fnBody(sql, 'delete_document'), /not \(v_admin or coalesce\(v_doc\.patient_id = public\.current_patient_id\(\), false\)\)/);
assert.match(fnBody(sql, 'case_own_message'), /if not coalesce\(\(m\.author_kind = 'paciente'[\s\S]*\), false\) then/);

// 4) Salud mental y ciclo: el admin no los lee (regla 4)
assert.match(sql, /create policy journal_admin_select on public\.journal_entries for select\s+using \(public\.is_patient_admin\(patient_id\) and scope not in \('salud_mental', 'ciclo'\)\)/);
assert.ok(!/create policy journal_admin_all/.test(sql), 'el admin ya no escribe directo en la bitácora');
assert.ok(!/cycle_logs/.test(sql), 'cycle_logs sigue sin política de admin');

// 5) Personas, plantillas y profesionales por organización; datos actuales a Medicina Humana
assert.match(sql, /alter table public\.patients alter column org_id set not null/);
assert.match(sql, /update public\.patients set org_id = \(select id from public\.organizations where slug = 'medicina-humana'\) where org_id is null/);
assert.match(sql, /create policy patients_admin_all on public\.patients for all using \(public\.is_org_admin\(org_id\)\) with check \(public\.is_org_admin\(org_id\)\)/);
assert.match(sql, /create policy templates_admin_all on public\.templates for all using \(public\.is_org_admin\(org_id\)\)/);
assert.match(sql, /create policy professionals_admin_delete[^;]*not public\.prof_linked_outside/);
assert.match(sql, /consent_texts_admin_write[^;]*is_platform_admin\(\)/);
assert.match(sql, /create unique index if not exists patients_email_unique on public\.patients \(lower\(email\)\)/);
for (const t of ['patients', 'templates', 'professionals']) assert.match(sql, new RegExp('create trigger ' + t + '_set_org before insert or update on public\\.' + t));

// 6) Storage: el admin abre solo archivos de personas de su organización
assert.match(sql, /documentos_admin_all[^;]*is_patient_admin_path\(\(storage\.foldername\(name\)\)\[1\]\)/);
assert.match(sql, /patient_exams_admin_all on storage\.objects[^;]*is_patient_admin_path/);

console.log('organizaciones: ok');
