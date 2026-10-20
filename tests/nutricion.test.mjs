import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const N = createRequire(import.meta.url)('../assets/nutricion.js');
const T = '2026-10-20';
const meals = [{ key: 'm1', name: 'Desayuno', time: '08:00', guide: 'Avena' }, { key: 'm2', name: 'Almuerzo', time: '13:30', guide: '' }];

// Plan: validación y limpieza
assert.equal(N.validatePlan(meals), null);
assert.match(N.validatePlan([]), /al menos una/);
assert.match(N.validatePlan([{ key: 'm1', name: ' ' }]), /nombre a la comida 1/);
assert.match(N.validatePlan([{ key: 'm1', name: 'A' }, { key: 'm1', name: 'B' }]), /repetidas/);
assert.match(N.validatePlan([{ key: 'm1', name: 'A', time: '25:00' }]), /hora de A/);
assert.match(N.validatePlan(Array.from({ length: 9 }, (_, k) => ({ key: 'm' + k, name: 'x' }))), /hasta 8/);
assert.equal(N.nextKey(meals), 'm3'); assert.equal(N.nextKey([{ key: 'm7' }, { key: 'm2' }]), 'm8'); assert.equal(N.nextKey([]), 'm1');
assert.deepEqual(N.cleanMeals([{ key: 'm1', name: ' Cena ', time: null, guide: '  ' }]), [{ key: 'm1', name: 'Cena', time: '', guide: '' }]);
assert.equal(N.validatePlan(N.TEMPLATE), null, 'la base sirve tal cual');

// Bitácora: mismo texto que set_nutrition_plan() en SQL
let j = N.planJournal(null, meals, '');
assert.equal(j.title, 'Nuevo plan de alimentación'); assert.equal(j.body, '2 comidas: Desayuno, Almuerzo.');
const prev = { meals, notes: null };
j = N.planJournal(prev, [{ ...meals[0], guide: 'Huevos' }, { key: 'm3', name: 'Cena', time: '', guide: '' }], 'Agua');
assert.equal(j.title, 'Plan de alimentación actualizado');
assert.equal(j.body, '2 comidas: Desayuno, Cena. Cambió: Desayuno, nueva: Cena, sin: Almuerzo, indicaciones.');
assert.equal(N.planJournal(prev, meals, '  ').body, '2 comidas: Desayuno, Almuerzo.', 'sin cambios no hay "Cambió"');
assert.equal(N.planJournal(null, [meals[0]], '').body, '1 comida: Desayuno.');

// Plan vigente por fecha: el último creado con valid_from <= fecha
const p1 = { id: 'a', valid_from: '2026-10-01', created_at: '2026-10-01T10:00:00Z', meals };
const p2 = { id: 'b', valid_from: '2026-10-15', created_at: '2026-10-15T10:00:00Z', meals: [meals[0]] };
const p3 = { id: 'c', valid_from: '2026-10-15', created_at: '2026-10-15T18:00:00Z', meals: [meals[1]] };
assert.equal(N.planFor([p1, p2, p3], '2026-10-10').id, 'a');
assert.equal(N.planFor([p3, p1, p2], '2026-10-16').id, 'c', 'dos versiones el mismo día: gana la última');
assert.equal(N.planFor([p1], '2026-09-30'), null);

// Adherencia: lo no registrado no es incumplido; parcial vale ½; se usa el plan vigente de cada día
const logs = { '2026-10-20': { m1: 2, m2: 1 }, '2026-10-19': { m1: 0 }, '2026-10-18': {} };
let a = N.adherence([p1], logs, T, 7);
assert.equal(a.expected, 14); assert.equal(a.logged, 3); assert.equal(a.pct, 50); assert.equal(a.constancia, 21);
assert.deepEqual(a.byMeal.map(b => [b.name, b.pct, b.logged]), [['Desayuno', 50, 2], ['Almuerzo', 50, 1]]);
assert.deepEqual(a.daily, [{ iso: '2026-10-19', value: 0 }, { iso: '2026-10-20', value: 75 }]);
a = N.adherence([p1, p2], { '2026-10-16': { m1: 2, m2: 0 } }, T, 7);
assert.equal(a.expected, 1 * 2 + 6 * 1, 'el 14 rige el plan de 2 comidas; desde el 15, el de 1'); assert.equal(a.logged, 1, 'm2 no está en el plan de ese día'); assert.equal(a.pct, 100);
a = N.adherence([], logs, T, 7); assert.equal(a.pct, null); assert.equal(N.adherenceText(a), 'Sin plan en este período.');
assert.equal(N.adherenceText(N.adherence([p1], {}, T, 7)), 'Sin registros en los últimos 7 días.');
const many = {}; for (let k = 0; k < 5; k++) many['2026-10-' + (16 + k)] = { m1: 2, m2: k % 2 ? 0 : 1 };
assert.equal(N.adherenceText(N.adherence([p1], many, T, 7)), 'Cumpliste el 65 % de lo que registraste. Registraste 10 de 14 comidas (71 %). La que más cuesta: Almuerzo (30 %).');

// Peso y composición desde Medidas
const m = { '2026-09-10': { weight_kg: 72.4, body_fat_pct: 22 }, '2026-09-25': { weight_kg: 71.8 }, '2026-10-18': { weight_kg: 71.1, body_fat_pct: 21.2, muscle_mass_kg: null } };
const b = N.bodySummary(m, T);
assert.equal(b[0].last.value, 71.1); assert.equal(b[0].dPrev, -0.7); assert.equal(b[0].dMonth, -1.3); assert.equal(b[0].monthIso, '2026-09-10');
assert.equal(b[1].dPrev, -0.8); assert.equal(b[2].last, null);
assert.equal(N.signed(-1.3, 'kg'), '−1,3 kg'); assert.equal(N.signed(0.5, '%'), '+0,5 %');
assert.equal(N.bodySummary({}, T)[0].last, null);

// Migración: idempotente, RLS, plan solo por función, acceso del profesional registrado
const sql = readFileSync(new URL('../supabase/migrations/20261027_nutricion.sql', import.meta.url), 'utf8');
for (const t of ['nutrition_plans', 'meal_logs']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + t + ' '), t + ' idempotente');
  assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'), t + ' con RLS');
}
const policies = [...sql.matchAll(/create policy (\w+) on/g)].map(x => x[1]);
assert.ok(policies.length >= 7);
policies.forEach(p => assert.match(sql, new RegExp('drop policy if exists ' + p + ' on'), p + ' se puede re-ejecutar'));
assert.doesNotMatch(sql, /on public\.nutrition_plans for (insert|update|delete|all)/, 'el plan solo se escribe por función');
assert.doesNotMatch(sql, /for \w+ using \([^;]*current_professional_id/, 'profesionales no leen las tablas directo');
assert.match(sql, /log_date between current_date - 7 and current_date/, 'registro hasta 7 días atrás');
assert.match(sql, /'nutricion' = any \(l\.scopes\)\) then v_kind := 'profesional'/, 'profesional escribe solo con permiso nutricion');
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\) values \(v_prof, p_patient, 'nutricion'\)/);
for (const t of ['Nuevo plan de alimentación', 'Plan de alimentación actualizado', ' comida: ', ' comidas: ', ' Cambió: ', "'nueva: '", "'sin: '", "'indicaciones'"])
  assert.ok(sql.includes(t), 'SQL y planJournal comparten el texto: ' + t);
assert.equal(N.MAX_MEALS, 8); assert.match(sql, /between 1 and 8/);
console.log('nutricion: OK');
