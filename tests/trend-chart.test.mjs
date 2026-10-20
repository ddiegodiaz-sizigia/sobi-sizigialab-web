import { createRequire } from 'node:module'; import assert from 'node:assert/strict';
const C = createRequire(import.meta.url)('../assets/trend-chart.js');
// HRV oscilando entre 60 y 72: el eje NO debe ir de 0 a 100 y el rango mínimo evita amplificar ruido
let d = C.domain([62, 64, 61, 66, 63], { minSpan: 15, clampMin: 0 });
assert.ok(d.lo >= 50 && d.hi <= 80, 'eje ajustado, no 0-100: ' + JSON.stringify(d));
assert.ok(d.hi - d.lo >= 15, 'respeta rango mínimo');
// Recuperación en % nunca pasa de 100
d = C.domain([90, 97, 99], { minSpan: 25, clampMin: 0, clampMax: 100 });
assert.equal(d.hi, 100);
// Franja exige 7 registros previos
const pts = []; for (let i = 0; i < 40; i++) pts.push({ iso: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10), value: 60 + (i % 5) });
assert.ok(C.baseline(pts, '2026-10-01'), 'hay franja con 28 días previos');
assert.equal(C.baseline(pts.slice(0, 5), '2026-10-01'), null, 'sin franja con pocos datos');
// build produce svg y respeta ventanas
const svg7 = C.build(pts, { metric: 'hrv', days: 7, today: '2026-10-10' });
assert.match(svg7, /<svg/); assert.match(svg7, /Eje ajustado/);
assert.match(C.build(pts.slice(0, 1), { metric: 'hrv', days: 7, today: '2026-09-01' }), /menos de 2 registros/);
console.log('trend-chart: OK');
