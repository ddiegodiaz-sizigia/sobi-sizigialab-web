import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const Q = createRequire(import.meta.url)('../assets/mi-equipo.js');

// Tipos de dato: los mismos 8 que acepta care_links_scopes_check (migraciones 20261020 y 20261029)
assert.deepEqual(Q.SCOPES.map(s => s.key), ['semaforo', 'lesiones', 'ciclo', 'nutricion', 'examenes', 'salud_mental', 'bitacora', 'equipo']);
assert.deepEqual(Q.SCOPES.filter(s => s.live).map(s => s.key), ['semaforo', 'lesiones', 'nutricion', 'examenes', 'equipo'], 'lo que hoy se ve en equipo.html');
const chk = readFileSync(new URL('../supabase/migrations/20261029_caso_equipo.sql', import.meta.url), 'utf8').match(/scopes <@ array\[([^\]]+)\]/)[1];
assert.deepEqual(chk.split(',').map(s => s.trim().replace(/'/g, '')).sort(), Q.SCOPES.map(s => s.key).sort(),'la app y el check SQL aceptan los mismos permisos');
assert.ok(Q.SCOPES.find(s => s.key === 'ciclo').sensitive && Q.SCOPES.find(s => s.key === 'salud_mental').sensitive);
assert.deepEqual(Q.normalizeScopes(['bitacora', 'x', 'semaforo', 'semaforo']), ['semaforo', 'bitacora'], 'filtra, deduplica y ordena');

// Invitación
const ok = { email: ' Paula@Ejemplo.cl ', name: 'Paula', role: 'kinesiologo', scopes: ['lesiones'] };
assert.equal(Q.validateInvite(ok), null);
assert.match(Q.validateInvite({ ...ok, email: 'paula@' }), /correo/);
assert.match(Q.validateInvite({ ...ok, name: ' ' }), /nombre/);
assert.match(Q.validateInvite({ ...ok, role: 'brujo' }), /rol/);
assert.match(Q.validateInvite({ ...ok, scopes: [] }), /al menos un dato/);

// Consentimiento: nombra al profesional, su rol y solo los datos elegidos
const body = Q.consentBody('Autorizas a {{PROFESIONAL}} ({{ROL}}):\n{{DATOS}}\nNada más.', { name: 'Paula', role: 'kinesiologo' }, ['lesiones', 'semaforo']);
assert.match(body, /^Autorizas a Paula \(kinesiólogo\):/);
assert.match(body, /- Semáforo y registro: .*\.\n- Lesiones: /, 'en orden fijo');
assert.doesNotMatch(body, /Ciclo|Salud mental/);

// Equipo: activo primero, historial separado
const team = Q.teamFromLinks([
  { professional_id: 'b', name: 'Tomás', role: 'entrenador', scopes: ['semaforo'], granted_at: '2026-10-01T10:00:00Z', revoked_at: '2026-10-05T10:00:00Z', has_account: true },
  { professional_id: 'a', name: 'Paula', role: 'kinesiologo', scopes: ['lesiones'], granted_at: '2026-10-02T10:00:00Z', revoked_at: '2026-10-08T10:00:00Z' },
  { professional_id: 'a', name: 'Paula', role: 'kinesiologo', scopes: ['lesiones', 'semaforo'], granted_at: '2026-10-08T10:00:00Z', revoked_at: null }
]);
assert.deepEqual(team.map(p => p.name), ['Paula', 'Tomás']);
assert.deepEqual(team[0].active.scopes, ['lesiones', 'semaforo']); assert.equal(team[0].history.length, 1);
assert.equal(team[1].active, null); assert.equal(team[1].hasAccount, true); assert.equal(team[0].hasAccount, false);

// Registro de accesos agrupado por día local de Chile, persona y tipo de dato
const g = Q.groupAccessLog([
  { accessed_at: '2026-10-20T15:00:00Z', name: 'Paula', role: 'kinesiologo', scope: 'semaforo' },
  { accessed_at: '2026-10-20T12:00:00Z', name: 'Paula', role: 'kinesiologo', scope: 'semaforo' },
  { accessed_at: '2026-10-20T12:30:00Z', name: 'Paula', role: 'kinesiologo', scope: 'lesiones' },
  { accessed_at: '2026-10-20T02:00:00Z', name: 'Paula', role: 'kinesiologo', scope: 'semaforo' }
], 'America/Santiago');
assert.deepEqual(g.map(x => [x.day, x.scope, x.count]), [['2026-10-20', 'semaforo', 2], ['2026-10-20', 'lesiones', 1], ['2026-10-19', 'semaforo', 1]], '02:00 UTC es 19-10 en Chile');
assert.equal(g[0].last, '2026-10-20T15:00:00Z');

assert.match(Q.waLink('Paula', 'Javiera'), /^https:\/\/wa\.me\/\?text=Hola%20Paula.*equipo\.html/);

// Migración: idempotente, funciones solo para usuarios con sesión, consentimiento con {{DATOS}}
const sql = readFileSync(new URL('../supabase/migrations/20261023_mi_equipo.sql', import.meta.url), 'utf8');
for (const f of ['invite_professional', 'grant_care_link', 'my_care_team', 'my_access_log']) {
  assert.match(sql, new RegExp('create or replace function public\\.' + f + '\\('), f);
  assert.match(sql, new RegExp('revoke all on function [^;]*public\\.' + f + '\\('), f + ' sin acceso anónimo');
}
assert.match(sql, /where l\.patient_id = public\.current_patient_id\(\)/, 'my_care_team solo lo propio');
assert.match(sql, /where a\.patient_id = public\.current_patient_id\(\)/, 'my_access_log solo lo propio');
assert.match(sql, /cardinality\(p_scopes\), 0\) = 0 then raise/, 'no se concede un permiso vacío');
assert.match(sql, /\{\{DATOS\}\}/); assert.match(sql, /on conflict \(version\) do nothing/);
assert.doesNotMatch(sql, /create table|drop table|delete from/i, 'no crea ni borra tablas');
console.log('mi-equipo: OK');
