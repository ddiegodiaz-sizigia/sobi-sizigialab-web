import { createRequire } from 'node:module'; import assert from 'node:assert/strict';
const S = createRequire(import.meta.url)('../assets/semaforo.js');
const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const logs = []; for (let i = 0; i < 30; i++) logs.push({ log_date: d(i), sleep_hours: 7.4, fatigue: 3, mood: 7, pain_level: 1, trained: true, session_rpe: 6, session_minutes: 60 });
const r = S.computeSemaforo(logs);
assert.equal(r.level, 'verde'); assert.match(r.why, /^Verde porque/); assert.match(r.why, /no que esté sana/);
assert.ok(r.checks.every(c => c.status === 'ok'));
const y = S.computeSemaforo([{ ...logs[0], sleep_hours: 5.2 }, ...logs.slice(1)]);
assert.equal(y.level, 'amarillo'); assert.match(y.why, /^Amarillo porque sueño de anoche 5,2 h/);
assert.equal(S.computeSemaforo([]).level, 'gris');
const few = S.computeSemaforo(logs.slice(0, 3)); assert.equal(few.checks.find(c => c.key === 'carga').status, 'nodata');

// Registro general (persona común): sin rojo, reglas visibles, diario o semanal
const W = (n, o) => ({ period: 'dia', log_date: d(n), energy: 7, sleep_hours: 7.5, sleep_quality: 7, stress: 4, habits: {}, ...o });
const cv = S.computeSemaforoComun([W(0), W(1), W(2)], 'diaria');
assert.equal(cv.level, 'verde'); assert.match(cv.why, /no tiene rojo/); assert.deepEqual(cv.checks.map(c => c.key), ['sueno', 'sueno3', 'energia', 'estres']);
const ca = S.computeSemaforoComun([W(0, { energy: 2, stress: 9 }), W(1)], 'diaria');
assert.equal(ca.level, 'amarillo'); assert.equal(ca.reasons.length, 2); assert.match(ca.why, /^Amarillo porque energía 2\/10/);
assert.equal(S.computeSemaforoComun([W(0, { energy: 1, stress: 10, sleep_hours: 3 })], 'diaria').level, 'amarillo', 'nunca rojo');
assert.equal(S.computeSemaforoComun([W(3)], 'diaria').level, 'gris');
// Pasó de diario a semanal: la semana se arma con el promedio de sus registros diarios (la historia no se pierde)
const fromDays = S.computeSemaforoComun([W(0, { sleep_hours: 5 }), W(1, { sleep_hours: 6 })], 'semanal');
assert.notEqual(fromDays.level, 'gris', 'los registros diarios de la semana cuentan para el semanal');
assert.match(fromDays.why, /se armó con el promedio de \d+ registros? diarios?/);
assert.equal(S.computeSemaforoComun([W(0, { sleep_hours: null })], 'diaria').checks[0].status, 'nodata');
const mon = S.semMonday(d(0)), monAgo = k => { const x = new Date(mon + 'T00:00:00'); x.setDate(x.getDate() - 7 * k); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const wk = k => ({ period: 'semana', log_date: monAgo(k), energy: 6, sleep_hours: 5.5, stress: 5, habits: {} });
const sw = S.computeSemaforoComun([wk(1)], 'semanal');
assert.equal(sw.level, 'amarillo', 'la semana pasada sigue vigente'); assert.match(sw.reasons[0].text, /^Sueño promedio de la semana: 5,5 h/);
assert.ok(!sw.checks.some(c => c.key === 'sueno3'), 'en el semanal no se promedian 3 registros');
assert.equal(S.computeSemaforoComun([wk(2)], 'semanal').level, 'gris'); assert.match(S.computeSemaforoComun([wk(2)], 'semanal').why, /esta semana ni de la anterior/);
// Pasó de semanal a diario: sin día vigente, su registro semanal reciente sirve de referencia
const ref = S.computeSemaforoComun([wk(0)], 'diaria');
assert.equal(ref.source, 'semanal'); assert.equal(ref.level, 'amarillo'); assert.match(ref.why, /^No hay registro diario/);
assert.equal(S.computeSemaforoComun([W(0), wk(0)], 'diaria').source, undefined, 'con día vigente manda el diario');
assert.equal(S.computeSemaforoComun([wk(2)], 'diaria').level, 'gris', 'un semanal viejo no sirve de referencia');
// Mezcla: semanas con registro semanal se respetan; semanas solo con días se arman; en diario, semanas sin días quedan como referencia
const mix = S.semLogsComun([wk(1), W(0, { habits: { Agua: 1 } }), W(1, { habits: { Agua: 1 } })], 'semanal');
assert.ok(mix.some(l => l.log_date === monAgo(1) && !l.derived)); 
assert.ok(mix.every(l => l.period === 'semana'));
const mixD = S.semLogsComun([wk(3), W(0)], 'diaria');
assert.equal(mixD.length, 2); assert.ok(mixD.find(l => l.period === 'semana').ref);
assert.equal(S.SEM_RULES_COMUN.energyYellow, 3); assert.equal(S.SEM_RULES_COMUN.stressYellow, 8);
console.log('semaforo: OK');
