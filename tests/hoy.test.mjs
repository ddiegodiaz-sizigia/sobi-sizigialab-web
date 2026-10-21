import { createRequire } from 'node:module'; import assert from 'node:assert/strict';
const H = createRequire(import.meta.url)('../assets/hoy.js');
const T = '2026-10-21';
const day = n => { const d = new Date(Date.parse(T + 'T00:00:00Z') - n * 86400000); return d.toISOString().slice(0, 10); };

// Navegación: espacio y sub-sección válidos
assert.deepEqual(H.normalizeNav(null), { space: 'hoy', sub: { historia: 'bitacora', cuerpo: 'medidas', equipo: 'equipo' } });
assert.deepEqual(H.normalizeNav({ space: 'cuerpo', sub: { cuerpo: 'lesiones', historia: 'nada' } }).sub, { historia: 'bitacora', cuerpo: 'lesiones', equipo: 'equipo' });
assert.equal(H.normalizeNav({ space: 'rueda' }).space, 'hoy');
assert.deepEqual(H.ORDER, ['hoy', 'historia', 'cuerpo', 'equipo']);
// Cada pantalla que existía tiene un lugar (salvo Resumen, que pasa a Hoy)
const subs = [].concat(...H.ORDER.map(k => H.SPACES[k].subs.map(s => s[0])));
['bitacora', 'medidas', 'examenes', 'lesiones', 'nutricion', 'equipo', 'sesiones', 'recursos', 'data'].forEach(t => assert.ok(subs.includes(t), t));

// Indicador: último valor frente al promedio de los días anteriores
const pts = [8, 7, 7.5, 8, 7, 7.5, 8].map((v, k) => ({ iso: day(7 - k), value: v })); // promedio 7,5
let i = H.indicator(pts.concat([{ iso: T, value: 6 }]), T, { dec: true });
assert.equal(i.value, 6); assert.equal(i.dir, 'down'); assert.equal(i.text, 'Bajo tu promedio (7,6)');
i = H.indicator(pts.concat([{ iso: T, value: 7.6 }]), T, { dec: true });
assert.equal(i.dir, 'flat'); assert.match(i.text, /^Como tu promedio/);
i = H.indicator(pts.concat([{ iso: T, value: 9 }]), T, { dec: true });
assert.equal(i.dir, 'up'); assert.match(i.text, /^Sobre/);
// Registro viejo: no se muestra como si fuera de hoy
assert.equal(H.indicator([{ iso: day(5), value: 7 }], T).value, null);
assert.equal(H.indicator([{ iso: day(5), value: 7 }], T, { maxAge: 13 }).value, 7);
// Menos de 3 registros previos: sin comparación
i = H.indicator([{ iso: day(1), value: 5 }, { iso: T, value: 6 }], T);
assert.equal(i.value, 6); assert.equal(i.avg, null); assert.match(i.text, /sin promedio/);
assert.equal(H.indicator([], T).text, 'Sin registro reciente');
// Futuro y vacíos no cuentan
assert.equal(H.indicator([{ iso: '2026-10-25', value: 3 }, { iso: T, value: null }], T).value, null);

// Lectura del día
assert.equal(H.reading({ level: 'gris', reasons: [] }, false).title, 'Aún no registras hoy');
assert.equal(H.reading({ level: 'gris', reasons: [] }, true).title, 'Aún faltan datos para calcular tu lectura');
let r = H.reading({ level: 'amarillo', reasons: [{ text: 'Sueño promedio de 6,0 h' }, { text: 'Fatiga alta' }] }, true);
assert.equal(r.word, 'Precaución'); assert.equal(r.title, 'Sueño promedio de 6,0 h'); assert.match(r.text, /Y 1 señal más\.$/);
r = H.reading({ level: 'rojo', reasons: [{ text: 'Dolor 7/10' }] }, true);
assert.equal(r.tone, 'rojo'); assert.match(r.text, /equipo/); assert.doesNotMatch(r.text, /señal/);
assert.equal(H.reading({ level: 'verde', reasons: [] }, true).word, 'Todo en orden');
assert.equal(H.reading(null, false).tone, 'gris');

// Tercer indicador
assert.equal(H.thirdMetric({ injuries: true, cycle: true, mode: 'deportivo' }), 'dolor');
assert.equal(H.thirdMetric({ injuries: false, cycle: true, mode: 'comun', habits: true }), 'ciclo');
assert.equal(H.thirdMetric({ mode: 'comun', habits: true }), 'habitos');
assert.equal(H.thirdMetric({ mode: 'comun', habits: false }), 'estres');
assert.equal(H.thirdMetric({ mode: 'deportivo' }), 'animo');

// Lo que viene
assert.deepEqual(H.upcoming({}), []);
const u = H.upcoming({ unread: 2, meals: { meals: 4, logged: 1 }, profileMissing: true });
assert.deepEqual(u.map(x => x.key), ['mensajes', 'comidas', 'perfil']);
assert.equal(u[0].text, 'Tienes 2 mensajes nuevos de tu equipo'); assert.deepEqual([u[0].space, u[0].sub], ['equipo', 'equipo']);
assert.equal(u[1].text, 'Registraste 1 de 4 comidas de tu plan de hoy'); assert.deepEqual([u[1].space, u[1].sub], ['cuerpo', 'nutricion']);
assert.equal(H.upcoming({ unread: 1 })[0].text, 'Tienes un mensaje nuevo de tu equipo');
assert.equal(H.upcoming({ meals: { meals: 3, logged: 0 } })[0].text, 'Tu plan de hoy tiene 3 comidas por registrar');
assert.deepEqual(H.upcoming({ meals: { meals: 3, logged: 3 } }), [], 'plan completo: nada pendiente');

console.log('hoy OK');
