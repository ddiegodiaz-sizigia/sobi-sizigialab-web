import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const F = createRequire(import.meta.url)('../assets/ficha-profesional.js');
const T = '2026-10-20';

// Secciones según permisos: portada (si hay algún tema de la hoja de vida), Caso, lesiones, exámenes y nutrición; en ese orden
assert.deepEqual(F.sections(['nutricion', 'semaforo', 'lesiones', 'ciclo']).map(s => s.key), ['portada', 'lesiones', 'nutricion'], 'la portada va primero si hay algún tema de la hoja de vida');
assert.deepEqual(F.sections(['semaforo']), []);
assert.deepEqual(F.sections(null), []);
assert.deepEqual(F.SECTIONS.map(s => s.rpc), ['case_feed', 'patient_lesiones', 'patient_examenes', 'patient_nutricion'], 'cada sección se lee por su función con registro de acceso');
assert.deepEqual(F.sections(['lesiones', 'equipo']).map(s => s.label), ['Portada', 'Caso', 'Lesiones'], 'portada y luego el Caso');
assert.deepEqual(F.sections(['equipo']).map(s => s.key), ['equipo'], 'solo conversación: sin portada');
assert.deepEqual(F.sections(['bitacora']).map(s => s.key), ['portada'], 'bitácora: solo la línea de tiempo');
assert.equal(F.PORTADA.rpc, 'patient_timeline');

// "Otras personas": con ficha pero fuera del panel del semáforo
const linked = [{ patient_id: 'a', scopes: ['semaforo', 'lesiones'] }, { patient_id: 'b', scopes: ['nutricion'] }, { patient_id: 'c', scopes: ['ciclo'] }];
assert.deepEqual(F.extraPeople(linked, ['a']).map(p => p.patient_id), ['b', 'c'], 'a ya está en el panel; c dio ciclo: tiene portada');
assert.deepEqual(F.extraPeople([{ patient_id: 'd', scopes: ['semaforo'] }], []), [], 'solo semáforo: sin ficha');

// Lesiones: mismo resumen que ve la persona; abiertas primero
const les = F.lesionesView(F.demoData('lesiones', T), T);
assert.deepEqual(les.map(x => x.injury.id), ['i1', 'i2']);
assert.equal(les[0].name, 'Rodilla (lado derecho)'); assert.equal(les[0].status, 'En rehabilitación'); assert.equal(les[0].open, true);
assert.equal(les[0].summary.text, 'Dolor bajó de 5 a 2/10 (último registro 20-10-2026).');
assert.equal(les[0].pain.length, 7); assert.equal(les[1].summary.days, 28);
assert.deepEqual(F.lesionesView({}, T), []);
const lesM = F.lesionesView(F.demoData('lesiones', T, 'demo-1'), T);
assert.equal(lesM[0].pain[6].eva, 7, 'demo: Matías coincide con su alerta roja del panel (dolor 7/10 hoy)');

// Exámenes: documentos con sus resultados, serie por marcador y lo que está fuera del rango del laboratorio
const ex = F.examenesView(F.demoData('examenes', T));
assert.deepEqual(ex.docs.map(d => [d.doc.id, d.results.length, d.category]), [['x2', 3, 'Examen de laboratorio'], ['x1', 2, 'Examen de laboratorio']]);
assert.deepEqual(ex.series.map(s => s.marker), ['ferritina', 'vitamina_d', 'glucosa']);
assert.deepEqual(ex.outOfRange, ['Vitamina D (25-OH)'], 'ferritina volvió al rango; vitamina D sigue bajo');
assert.deepEqual(F.examenesView({}).docs, []);

// Nutrición: plan vigente, adherencia 7/28 días y peso desde Medidas
const nu = F.nutricionView(F.demoData('nutricion', T), T);
assert.equal(nu.plan.id, 'np1'); assert.equal(nu.versions, 1);
assert.equal(nu.a7.expected, 28); assert.equal(nu.a7.logged, 26);
assert.equal(nu.a28.logged, 37, 'los 10 días con registro caen en la ventana de 28');
assert.equal(nu.body[0].last.value, 76.5); assert.equal(nu.body[0].dMonth, -0.9, 'contra la última medición de hace 4 semanas o más (día 30)');
const empty = F.nutricionView({}, T); assert.equal(empty.plan, null); assert.equal(empty.a7.expected, 0);
// Si el plan aún no rige hoy (creado con fecha posterior), igual se muestra el último
assert.equal(F.nutricionView({ plans: [{ id: 'z', valid_from: '2026-10-21', created_at: '2026-10-21T01:00:00Z', meals: [{ key: 'm1', name: 'A' }] }] }, T).plan.id, 'z');

// Demo: las personas del panel conservan su id y se agregan dos solo con ficha
const dl = F.demoLinked([{ patient_id: 'p0', patient_name: 'Ana' }, { patient_id: 'p1', patient_name: 'Beto' }, { patient_id: 'demo-1', patient_name: 'Matías' }]);
assert.deepEqual(dl[0].scopes, ['semaforo', 'lesiones', 'equipo', 'examenes', 'nutricion']); assert.deepEqual(dl[1].scopes, ['semaforo']);
assert.ok(dl[2].scopes.includes('equipo'), 'demo: Matías tiene caso (lo abre la bandeja del panel)');
assert.equal(F.extraPeople(dl, ['p0', 'p1', 'demo-1']).length, 2);

// Migración: lista sin datos de salud y solo para usuarios con sesión
const sql = readFileSync(new URL('../supabase/migrations/20261028_ficha_profesional.sql', import.meta.url), 'utf8');
assert.match(sql, /create or replace function public\.my_linked_patients\(\)/);
assert.match(sql, /l\.professional_id = v_prof and l\.revoked_at is null/, 'solo vínculos activos del profesional');
assert.doesNotMatch(sql, /athlete_logs|injuries|documents|nutrition_plans|measurements|wellness_logs/, 'sin datos de salud');
assert.match(sql, /revoke all on function public\.my_linked_patients\(\) from public, anon/);

// Portada: resumen con lo autorizado y línea de tiempo
const pd = F.demoData('portada', T, 'demo-1');
const prow = { level: 'rojo', frequency: 'diaria', sem: { reasons: [{ text: 'Dolor 7/10 en Rodilla' }] }, adherence: { done: 6, expected: 7 } };
let pv = F.portadaView({ timeline: pd, lesiones: F.demoData('lesiones', T, 'demo-1'), examenes: F.demoData('examenes', T, 'demo-1'), row: prow }, T);
assert.deepEqual(pv.sem, { level: 'rojo', reasons: ['Dolor 7/10 en Rodilla'], adherence: '6/7', weekly: false });
assert.equal(pv.injuries.length, 1, 'solo lesiones abiertas'); assert.match(pv.injuries[0].name, /Rodilla/); assert.match(pv.injuries[0].text, /subió de 5 a 7/);
assert.ok(pv.exams.outOfRange.length >= 1); assert.ok(pv.exams.last.title);
assert.equal(pv.items.length, pd.entries.length); assert.equal(pv.items[0].authorName, 'Camila Soto');
// Sin permiso de lesiones ni exámenes, ni fila del panel: esas partes quedan vacías (null), no se inventan
pv = F.portadaView({ timeline: { scopes: ['bitacora'], entries: [] } }, T);
assert.equal(pv.sem, null); assert.equal(pv.injuries, null); assert.equal(pv.exams, null); assert.deepEqual(pv.items, []); assert.deepEqual(pv.scopes, ['bitacora']);
console.log('ficha-profesional: OK');
