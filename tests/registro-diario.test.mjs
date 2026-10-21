import { createRequire } from 'node:module'; import assert from 'node:assert/strict';
const D = createRequire(import.meta.url)('../assets/registro-diario.js');
const T = '2026-10-21', MON = '2026-10-20';
const dep = { mode: 'deportivo', frequency: 'diaria', habits: [], injuries: [], cycle: false };
const gen = { mode: 'comun', frequency: 'diaria', habits: ['Caminar', 'Agua'], injuries: [], cycle: false };

// Pasos según el tipo de registro
assert.deepEqual(D.steps(dep), ['sueno', 'fatiga', 'animo', 'dolor', 'entreno', 'nota']);
assert.deepEqual(D.steps(gen), ['sueno', 'energia', 'estres', 'habitos', 'nota']);
assert.deepEqual(D.steps({ ...gen, habits: [] }), ['sueno', 'energia', 'estres', 'nota']);
const full = { ...dep, injuries: [{ id: 'r', name: 'Rodilla (lado derecho)', last: 4 }], cycle: true };
assert.deepEqual(D.steps(full), ['sueno', 'fatiga', 'animo', 'dolor', 'lesiones', 'entreno', 'ciclo', 'nota']);
// Semanal: sin lesiones ni ciclo (son de cada día)
assert.deepEqual(D.steps({ ...gen, frequency: 'semanal', injuries: full.injuries, cycle: true }), ['sueno', 'energia', 'estres', 'habitos', 'nota']);

// Valores iniciales: vacío para elegir con un toque; lo registrado hoy si existe
let a = D.defaults(full, {});
assert.equal(a.sleep_hours, 7); assert.equal(a.fatigue, null); assert.equal(a.trained, null); assert.equal(a.injuries.r, null); assert.equal(a.bleeding, null);
a = D.defaults(full, { athlete: { sleep_hours: 6.5, sleep_quality: 7, fatigue: 4, mood: 8, pain_level: 2, pain_zone: 'Rodilla', trained: true, session_rpe: 6, session_minutes: 75, notes: 'ok' }, pain: { r: 3 }, cycle: { bleeding: true, flow: 2, symptoms: ['Fatiga'] } });
assert.equal(a.sleep_hours, 6.5); assert.equal(a.trained, true); assert.equal(a.session_minutes, 75); assert.equal(a.injuries.r, 3); assert.equal(a.flow, 2); assert.deepEqual(a.symptoms, ['Fatiga']);
const g0 = D.defaults(gen, { wellness: { energy: 6, stress: 3, sleep_hours: 8, habits: { Caminar: 1 } } });
assert.deepEqual(g0.habits, { Caminar: 1, Agua: 0 });

// Validación por paso
let b = D.defaults(full, {});
assert.match(D.validateStep('sueno', b, full), /dormiste/);
b.sleep_quality = 6; assert.equal(D.validateStep('sueno', b, full), null);
b.sleep_hours = 17; assert.match(D.validateStep('sueno', b, full), /0 a 16/); b.sleep_hours = 7;
assert.equal(D.validateStep('sueno', D.defaults(gen, {}), gen), null); // calidad opcional en el general
assert.match(D.validateStep('dolor', b, full), /0 si no/);
b.pain_level = 0; assert.equal(D.validateStep('dolor', b, full), null);
assert.match(D.validateStep('lesiones', b, full), /Rodilla/);
assert.match(D.validateStep('entreno', b, full), /entrenaste/);
b.trained = true; assert.match(D.validateStep('entreno', b, full), /exigente/);
b.session_rpe = 7; b.session_minutes = 0; assert.match(D.validateStep('entreno', b, full), /minutos/);
b.session_minutes = 60; assert.equal(D.validateStep('entreno', b, full), null);
assert.match(D.validateStep('ciclo', b, full), /sangrado/);
assert.match(D.validateStep('fatiga', { fatigue: 11 }, full), /fatiga/);
const w = { ...gen, frequency: 'semanal' }, wa = D.defaults(w, {}); wa.habits.Caminar = 8;
assert.match(D.validateStep('habitos', wa, w), /Caminar/);
// Primer error: vuelve al paso que falta
b.fatigue = 5; b.mood = 6; b.injuries.r = 2; b.bleeding = false;
assert.equal(D.firstError(full, b), null);
b.mood = null; assert.deepEqual(D.firstError(full, b), { step: 2, error: 'Elige tu ánimo de hoy.' });

// Filas: deportivo
b.mood = 6; b.pain_level = 3; b.pain_zone = 'Rodilla'; b.notes = '  ';
let r = D.buildRows(full, b, T, T);
assert.deepEqual(r.athlete, { log_date: T, sleep_hours: 7, sleep_quality: 6, fatigue: 5, mood: 6, pain_level: 3, pain_zone: 'Rodilla', trained: true, session_rpe: 7, session_minutes: 60, notes: null });
assert.equal(r.wellness, null);
assert.deepEqual(r.pain, [{ id: 'r', eva: 2 }]);
assert.deepEqual(r.cycle, { bleeding: false, flow: null, symptoms: [] });
b.trained = false; b.pain_level = 0;
r = D.buildRows(full, b, T, T);
assert.equal(r.athlete.session_rpe, null); assert.equal(r.athlete.session_minutes, null); assert.equal(r.athlete.pain_zone, null);
// Sin lesiones ni ciclo no hay filas extra
assert.deepEqual(D.buildRows(dep, b, T, T).pain, []); assert.equal(D.buildRows(dep, b, T, T).cycle, null);

// Filas: general diario y semanal (se guarda en el lunes)
const ga = D.defaults(gen, {}); ga.energy = 7; ga.stress = 4; ga.sleep_hours = 6.5; ga.habits.Agua = 1; ga.notes = 'Bien';
assert.deepEqual(D.buildRows(gen, ga, T, MON).wellness, { period: 'dia', log_date: T, energy: 7, sleep_hours: 6.5, sleep_quality: null, stress: 4, habits: { Caminar: 0, Agua: 1 }, notes: 'Bien' });
const wr = D.buildRows(w, ga, T, MON).wellness;
assert.equal(wr.period, 'semana'); assert.equal(wr.log_date, MON);
assert.equal(D.buildRows(gen, ga, T, MON).athlete, null);

console.log('registro-diario OK');
