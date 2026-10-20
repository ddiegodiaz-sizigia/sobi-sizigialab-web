import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const C = createRequire(import.meta.url)('../assets/panel-coach.js');
const today = C.localISO(new Date());
const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return C.localISO(x); };
const ath = (n, over) => { const out = []; for (let i = 0; i < n; i++) out.push({ log_date: d(i), sleep_hours: 7.4, fatigue: 3, mood: 7, pain_level: 1, trained: true, session_rpe: 6, session_minutes: 60, ...(i === 0 ? over : {}) }); return out; };
const well = (n, over) => { const out = []; for (let i = 0; i < n; i++) out.push({ period: 'dia', log_date: d(i), energy: 7, sleep_hours: 7.5, sleep_quality: 7, stress: 4, habits: { Caminar: 1 }, ...(i === 0 ? over : {}) }); return out; };
const p = (name, o) => ({ patient_id: name, patient_name: name, mode: 'deportivo', frequency: 'diaria', habits: [], athlete: [], wellness: [], last_contact: null, ...o });

// Fila verde: sin pendientes, constancia 7/7
const ok = C.buildRow(p('Ana', { athlete: ath(30) }), today);
assert.equal(ok.level, 'verde'); assert.deepEqual(ok.pending, []); assert.equal(ok.adherence.done, 7); assert.equal(ok.mode, 'deportivo');

// Alerta roja por dolor: pendiente con motivo corto, sin el paréntesis de umbrales
const red = C.buildRow(p('Matías', { athlete: ath(30, { pain_level: 7, pain_zone: 'Rodilla' }) }), today);
assert.equal(red.level, 'rojo'); assert.equal(red.pending[0].key, 'alerta'); assert.equal(red.pending[0].text, 'Alerta roja: dolor 7/10');
assert.equal(C.alertText(C.buildRow(p('V', { athlete: ath(30, { sleep_hours: 5.2 }) }), today).sem), 'sueño de anoche 5,2 h');

// Contactar después del último registro limpia la alerta; un contacto anterior al registro no
const contactedToday = { at: new Date().toISOString(), template: 'alerta' };
assert.deepEqual(C.buildRow(p('M', { athlete: ath(30, { pain_level: 7 }), last_contact: contactedToday }), today).pending, []);
const old = { at: new Date(Date.now() - 3 * 86400000).toISOString(), template: 'alerta' };
assert.equal(C.buildRow(p('M', { athlete: ath(30, { pain_level: 7 }), last_contact: old }), today).pending[0].key, 'alerta');

// Sin registro reciente: gris con pendiente "recordatorio"; si ya le escribiste hace < 3 días, no vuelve a aparecer
const gray = C.buildRow(p('Ben', { athlete: ath(30).slice(5) }), today);
assert.equal(gray.level, 'gris'); assert.equal(gray.pending[0].key, 'sin_registro'); assert.equal(gray.pending[0].template, 'recordatorio');
assert.match(gray.pending[0].text, /^Sin registro desde el \d\d-\d\d$/);
assert.equal(C.buildRow(p('N', {}), today).pending[0].text, 'Nunca ha registrado');
assert.equal(C.buildRow(p('W', { mode: 'comun', frequency: 'semanal', habits: ['Caminar'], wellness: well(5) }), today).pending[0].text, 'Sin registro semanal todavía', 'cambió de diario a semanal');
assert.deepEqual(C.buildRow(p('Ben', { athlete: ath(30).slice(5), last_contact: contactedToday }), today).pending, []);

// Constancia baja: 3 de 7 días, con dato vigente
const low = C.buildRow(p('Ant', { athlete: [0, 2, 5].map(i => ath(30)[i]) }), today);
assert.equal(low.adherence.done, 3); assert.ok(low.pending.some(x => x.key === 'constancia'));

// Registro general: semáforo general, sin hábitos = pendiente, estadísticas de hábitos
const gen = C.buildRow(p('Sofía', { mode: 'comun', habits: ['Caminar'], wellness: well(20, { energy: 3 }) }), today);
assert.equal(gen.mode, 'comun'); assert.equal(gen.level, 'amarillo'); assert.equal(gen.pending[0].text, 'Alerta: energía 3/10');
assert.equal(gen.habitStats[0].pct, 100);
assert.ok(C.buildRow(p('F', { mode: 'comun', wellness: well(10) }), today).pending.some(x => x.key === 'sin_habitos'));

// Orden: rojo, amarillo, gris, verde; filtros por color, tipo, pendientes y nombre (sin tildes)
const rows = C.buildRows([p('Ana', { athlete: ath(30) }), p('Ben', { athlete: ath(30).slice(5) }), p('Matías', { athlete: ath(30, { pain_level: 7 }) }), gen.raw], today);
assert.deepEqual(rows.map(r => r.level), ['rojo', 'amarillo', 'gris', 'verde']);
assert.deepEqual(C.filterRows(rows, { level: 'gris' }).map(r => r.name), ['Ben']);
assert.deepEqual(C.filterRows(rows, { mode: 'comun' }).map(r => r.name), ['Sofía']);
assert.deepEqual(C.filterRows(rows, { q: 'matias' }).map(r => r.name), ['Matías']);
assert.equal(C.filterRows(rows, { pending: true }).length, 3);
const s = C.summary(rows);
assert.deepEqual([s.total, s.rojo, s.amarillo, s.gris, s.verde, s.pending], [4, 1, 1, 1, 1, 3]);
assert.ok(s.adherencePct > 0 && s.adherencePct <= 100);

// Mensajes: nombre de pila, sin diagnóstico, enlace a la app
const link = 'https://sizigialab.cl/rueda_final.html';
assert.equal(C.message('recordatorio', gray, { link }), 'Hola Ben, ¿cómo vas? Te recuerdo cargar tu registro de hoy en Sizigia Lab: toma menos de un minuto. ' + link);
assert.match(C.message('alerta', red, { link }), /^Hola Matías, vi en tu registro del \d\d-\d\d: dolor 7\/10\. ¿Cómo te sientes\?/);
assert.match(C.message('constancia', ok), /buena constancia! Llevas 7 de 7 registros en los últimos 7 días/);
assert.match(C.message('constancia', C.buildRow(p('A', { mode: 'comun', habits: ['Caminar'], wellness: [0, 3].map(i => well(5)[i]) }), today)), /una vez por semana/);
assert.match(C.message('habitos', gen, { link }), /tus hábitos para estas semanas: Caminar\./);
assert.equal(C.firstName('  María José Pérez '), 'María');
assert.equal(C.waLink('Hola Ana, ¿todo bien?'), 'https://wa.me/?text=Hola%20Ana%2C%20%C2%BFtodo%20bien%3F');
for (const r of rows) for (const t of C.TEMPLATES) assert.doesNotMatch(C.message(t.key, r, { link }), /diagn|lesi[oó]n grave|no entrenes/i);

// Plantillas: las mismas que acepta la migración
const sql = readFileSync(new URL('../supabase/migrations/20261025_panel_coach.sql', import.meta.url), 'utf8');
const inSql = sql.match(/template in \(([^)]+)\)/)[1].replace(/'/g, '').split(',');
assert.deepEqual(C.TEMPLATES.map(t => t.key), inSql);

// Demo: 14 personas, con todos los colores y al menos un contactado sin pendientes
const demo = C.buildRows(C.demoFeed(today), today);
assert.equal(demo.length, 14);
for (const lv of ['rojo', 'amarillo', 'gris', 'verde']) assert.ok(demo.some(r => r.level === lv), 'demo sin ' + lv);
assert.ok(demo.some(r => r.contactDate && !r.pending.length));
console.log('panel-coach ok');
