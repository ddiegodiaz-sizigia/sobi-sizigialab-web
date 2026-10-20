import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const L = createRequire(import.meta.url)('../assets/lesiones.js');
const T = '2026-10-20';
const base = { id: 'a', onset_date: '2026-10-08', zone: 'Rodilla', side: 'derecha', title: 'Tendinopatía rotuliana', eva_initial: 5, treating: 'Kine', status: 'activa', discharge_date: null, notes: null };

// Validación
assert.equal(L.validate(base, T), null);
assert.match(L.validate({ ...base, zone: '' }, T), /zona/);
assert.match(L.validate({ ...base, title: '  ' }, T), /Describe/);
assert.match(L.validate({ ...base, onset_date: '2026-10-21' }, T), /futura/);
assert.match(L.validate({ ...base, eva_initial: 11 }, T), /0 a 10/);
assert.match(L.validate({ ...base, status: 'alta' }, T), /fecha de alta/);
assert.match(L.validate({ ...base, status: 'alta', discharge_date: '2026-10-01' }, T), /anterior/);
assert.equal(L.validate({ ...base, status: 'alta', discharge_date: '2026-10-20' }, T), null);

// Bitácora: cada cambio genera entrada (mismas reglas que el trigger SQL)
let c = L.describeChange(null, base);
assert.equal(c.title, 'Nueva lesión: Rodilla (lado derecho)'); assert.equal(c.date, '2026-10-08');
assert.equal(c.body, 'Tendinopatía rotuliana. EVA inicial 5/10. Tratante: Kine');
assert.equal(L.describeChange(base, { ...base, status: 'rehabilitacion' }).title, 'En rehabilitación: Rodilla (lado derecho)');
c = L.describeChange(base, { ...base, status: 'alta', discharge_date: '2026-10-20' });
assert.equal(c.title, 'Alta: Rodilla (lado derecho)'); assert.match(c.body, /Alta el 20-10-2026$/);
assert.equal(L.describeChange({ ...base, status: 'alta', discharge_date: T }, base).title, 'Recaída: Rodilla (lado derecho)');
c = L.describeChange(base, { ...base, treating: 'Dr. Acuña', notes: 'Excéntricos' });
assert.equal(c.title, 'Lesión actualizada: Rodilla (lado derecho)'); assert.equal(c.body, 'Cambió: tratante, notas. Notas: Excéntricos');
assert.equal(L.describeChange(base, { ...base, side: 'izquierda' }).body, 'Cambió: zona.');
assert.equal(L.describeChange(base, { ...base, eva_initial: '5', notes: '' }), null, 'sin cambios reales no hay entrada');
assert.equal(L.injuryName({ zone: 'Hombro', side: 'bilateral' }), 'Hombro (bilateral)');
assert.equal(L.injuryName({ zone: 'Zona lumbar', side: 'no_aplica' }), 'Zona lumbar');

// Resumen informativo
let s = L.summary(base, [{ log_date: '2026-10-19', eva: 3 }, { log_date: '2026-10-10', eva: 5 }], T);
assert.equal(s.days, 12); assert.equal(s.evaNow, 3); assert.equal(s.loggedToday, false);
assert.equal(s.text, 'Dolor bajó de 5 a 3/10 (último registro 19-10-2026).');
s = L.summary({ ...base, eva_initial: null }, [], T); assert.equal(s.text, 'Sin registros de dolor todavía.');
s = L.summary(base, [], T); assert.equal(s.text, 'EVA inicial 5/10. Sin registros diarios todavía.');
s = L.summary({ ...base, status: 'alta', discharge_date: '2026-10-18' }, [{ log_date: T, eva: 6 }], T);
assert.equal(s.days, 10, 'duración hasta el alta'); assert.match(s.text, /subió de 5 a 6/); assert.equal(s.loggedToday, true);

// Dolor diario enlazado: sugerencia desde el registro diario solo si coincide la zona
assert.equal(L.suggestEva(base, { pain_level: 4, pain_zone: 'Rodilla' }), 4);
assert.equal(L.suggestEva(base, { pain_level: 4, pain_zone: 'Hombro' }), null);
assert.equal(L.suggestEva(base, { pain_level: 0, pain_zone: null }), null);
assert.equal(L.suggestEva(base, undefined), null);

// Orden: abiertas primero, luego por fecha de inicio descendente
const ord = L.sortInjuries([{ id: 1, status: 'alta', onset_date: '2026-10-10' }, { id: 2, status: 'activa', onset_date: '2026-01-01' }, { id: 3, status: 'rehabilitacion', onset_date: '2026-05-01' }]);
assert.deepEqual(ord.map(x => x.id), [3, 2, 1]);

// Migración: idempotente, con RLS, sin lectura de profesionales por tabla y con registro de acceso
const sql = readFileSync(new URL('../supabase/migrations/20261022_lesiones.sql', import.meta.url), 'utf8');
for (const t of ['injuries', 'injury_pain_logs']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + t + ' '), t + ' idempotente');
  assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'), t + ' con RLS');
}
const policies = [...sql.matchAll(/create policy (\w+) on/g)].map(m => m[1]);
assert.ok(policies.length >= 6);
policies.forEach(p => assert.match(sql, new RegExp('drop policy if exists ' + p + ' on'), p + ' se puede re-ejecutar'));
assert.match(sql, /drop trigger if exists injuries_journal/);
assert.doesNotMatch(sql, /current_professional_id\(\)\s*\)?\s*with check|for select\s+using \(.*current_professional_id/, 'profesionales no leen la tabla directo');
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\) values \(v_prof, p_patient, 'lesiones'\)/);
assert.match(sql, /'lesion', v_title, v_body, v_author, 'lesiones'/, 'el trigger escribe en la bitácora');
for (const t of ['Nueva lesión: ', 'Alta: ', 'Recaída: ', 'En rehabilitación: ', 'Lesión actualizada: ', 'Cambió: '])
  assert.ok(sql.includes("'" + t), 'trigger y describeChange comparten el texto: ' + t);
console.log('lesiones: OK');
