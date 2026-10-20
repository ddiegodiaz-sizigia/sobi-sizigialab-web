import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const C = createRequire(import.meta.url)('../assets/caso.js');
const NOW = Date.parse('2026-10-20T15:00:00Z');

// Temas: los mismos del check SQL; el scope de la bitácora coincide con case_journal_scope()
const sql = readFileSync(new URL('../supabase/migrations/20261029_caso_equipo.sql', import.meta.url), 'utf8');
const sqlTopics = sql.match(/topic in \(([^)]+)\)\)/)[1].split(',').map(s => s.trim().replace(/'/g, ''));
assert.deepEqual(sqlTopics, C.TOPICS.map(t => t.key));
assert.equal(C.journalScope('lesiones'), 'lesiones'); assert.equal(C.journalScope('general'), 'bitacora'); assert.equal(C.journalScope('semaforo'), 'bitacora');
assert.match(sql, /when p_topic in \('lesiones','examenes','nutricion','salud_mental','ciclo'\) then p_topic else 'bitacora'/, 'misma regla en SQL');

// Quién puede leer: equipo del demo (Tomás entrenador: general, semáforo, lesiones; Manuel todo; Paula kine; Valentina psicóloga)
const pro = C.demoFeed('pro', NOW), team = pro.team, me = 'pro-tf';
assert.deepEqual(C.readersFor(team, 'lesiones', me).map(p => p.id), ['pro-ma', 'pro-pr'], 'sin quien escribe');
assert.deepEqual(C.readersFor(team, 'salud_mental', me).map(p => p.id), ['pro-ma', 'pro-vm']);
assert.deepEqual(C.topicsFor('pro', team, me).map(t => t.key), ['general', 'semaforo', 'lesiones'], 'el profesional solo abre hilos de temas que él lee');
assert.equal(C.topicsFor('persona', team, null).length, 7, 'la persona: temas que alguien de su equipo lee');
assert.deepEqual(C.topicsFor('persona', team.filter(p => p.id === 'pro-vm'), null).map(t => t.key), ['general', 'salud_mental']);

// Validación (misma lógica que post_case_message)
const ctxPro = { mode: 'pro', team, me }, ctxPer = { mode: 'persona', team, me: null };
const base = { thread: null, title: 'Rodilla', topic: 'lesiones', body: 'Hola', audience: 'equipo_persona', to: [], withPatient: false, mentions: [], journal: '' };
assert.equal(C.validate(base, ctxPro), null);
assert.match(C.validate({ ...base, title: ' ' }, ctxPro), /título/);
assert.match(C.validate({ ...base, body: 'x'.repeat(4001) }, ctxPro), /largo/);
assert.match(C.validate({ ...base, audience: 'equipo' }, ctxPer), /a quién va/, 'la persona no escribe "solo profesionales"');
assert.match(C.validate({ ...base, audience: 'directo', to: ['pro-vm'] }, ctxPro), /Valentina Mora no tiene permiso para el tema lesiones/);
assert.match(C.validate({ ...base, audience: 'directo', to: [] }, ctxPro), /a quién va/);
assert.equal(C.validate({ ...base, audience: 'directo', to: [], withPatient: true }, ctxPro), null, 'el profesional puede escribirle solo a la persona');
assert.match(C.validate({ ...base, audience: 'directo', to: [] }, ctxPer), /a quién va/);
assert.equal(C.validate({ ...base, audience: 'directo', to: ['pro-pr'] }, ctxPer), null, 'la persona le escribe a uno solo');
assert.match(C.validate({ ...base, audience: 'directo', to: ['pro-pr'], mentions: ['pro-ma'] }, ctxPro), /mencionar/);
assert.equal(C.validate({ ...base, mentions: ['pro-ma'] }, ctxPro), null);
assert.match(C.validate({ ...base, topic: 'examenes' }, { mode: 'persona', team: team.filter(p => p.id !== 'pro-ma'), me: null }), /Nadie del equipo puede leer el tema exámenes/);
assert.match(C.validate({ ...base, ref: { kind: 'examen', id: 'x' } }, ctxPro), /no corresponde/);
assert.equal(C.validate({ ...base, thread: 't1', title: '' }, ctxPro), null, 'responder no pide título');
assert.deepEqual(C.recipients({ ...base, audience: 'equipo' }, ctxPro), { pros: ['pro-ma', 'pro-pr'], patient: false, readers: ['pro-ma', 'pro-pr'] });

// Hilos del profesional: solo lo dirigido a él y de temas que lee; más reciente primero
const tp = C.buildThreads(pro);
assert.deepEqual(tp.map(t => t.thread.id), ['t4', 't1'], 'exámenes y salud mental no le llegan');
assert.equal(tp[1].items.length, 3); assert.equal(tp[1].unread, 2); assert.equal(tp[1].mentions, 1, 'Manuel lo mencionó');
assert.deepEqual(tp[1].people, ['Paula Rojas', 'Dr. Manuel Acuña']);

// Hilos de la persona: lo que es solo entre profesionales aparece sin contenido
const per = C.demoFeed('persona', NOW), tq = C.buildThreads(per);
assert.deepEqual(tq.map(t => t.thread.id), ['t4', 't1', 't3', 't2']);
const t1 = tq.find(t => t.thread.id === 't1'), t3 = tq.find(t => t.thread.id === 't3');
assert.equal(t1.hidden, 1); assert.equal(t1.items[1].msg.body, undefined, 'el servidor no manda el texto');
assert.equal(t3.onlyHidden, true); assert.equal(t3.thread.title, null, 'ni el título de un hilo solo entre profesionales');
assert.equal(tq[0].unread, 1);

// Versiones: se muestra la última y se guarda el historial
const ed = JSON.parse(JSON.stringify(pro));
ed.messages.push({ ...ed.messages.find(m => m.id === 'm6'), id: 'm6b', version: 2, body: 'Corrección: 60 %.', created_at: new Date(NOW).toISOString() });
const t4 = C.buildThreads(ed).find(t => t.thread.id === 't4');
assert.equal(t4.items.length, 1); assert.equal(t4.items[0].msg.body, 'Corrección: 60 %.'); assert.equal(t4.items[0].edited, true); assert.equal(t4.items[0].history.length, 1);

// Textos
const m2 = pro.messages.find(m => m.id === 'm2');
assert.equal(C.audienceText(m2, 'pro'), 'Solo profesionales: Tomás Fuentes y Paula Rojas');
assert.equal(C.audienceText({ audience: 'equipo_persona' }, 'persona'), 'Para todo el equipo y ti');
assert.equal(C.audienceText({ audience: 'equipo_persona', author_kind: 'paciente' }, 'pro'), 'Para todo el equipo', 'si escribe la persona, no se nombra a sí misma');
assert.equal(C.audienceText({ audience: 'directo', author_kind: 'profesional', patient_can_read: true, to: [{ name: 'Paula' }] }, 'pro'), 'Para Paula y la persona');
assert.equal(C.readText({ reads: [{ name: 'Paula' }, { patient: true }] }, 'pro'), 'Leído por Paula y la persona');
assert.equal(C.readText({ reads: [] }, 'pro'), 'Nadie lo ha leído todavía');
const wa = decodeURIComponent(C.waNotify(['Paula'], 'Matías'));
assert.match(wa, /^https:\/\/wa\.me\/\?text=Hola Paula, te escribí en el caso de Matías/); assert.doesNotMatch(wa, /rodilla|dolor/i, 'el aviso no lleva el contenido');
assert.deepEqual(C.inboxSort([{ patient_id: 'a', unread: 1, mentions: 0, last_at: '2026-10-20' }, { patient_id: 'b', unread: 0, mentions: 0, last_at: '2026-10-21' }, { patient_id: 'c', unread: 2, mentions: 1, last_at: '2026-10-01' }]).map(r => r.patient_id), ['c', 'a'], 'menciones primero; sin pendientes fuera');

// Migración: nadie lee las tablas directo (tampoco admin), todo por funciones con permiso y registro
for (const t of ['case_threads', 'case_messages', 'case_recipients', 'case_mentions', 'case_reads']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + t + ' '), t);
  assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'), t + ' con RLS');
}
assert.doesNotMatch(sql, /create policy/i, 'sin políticas: ni el admin lee por RLS directo');
assert.doesNotMatch(sql, /drop table|delete from/i, 'nada se borra');
assert.match(sql, /'equipo' = any \(l\.scopes\) and \(p_topic = 'general' or p_topic = any \(l\.scopes\)\)/, 'leer pide equipo + permiso del tema');
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\) values \(v_prof, p_patient, 'equipo'\)/, 'case_feed registra el acceso');
assert.match(sql, /case_message_json\(m\.id, null, not \(m\.patient_can_read or m\.author_kind = 'paciente'\)\)/, 'la persona ve sin contenido lo que no es para ella');
assert.match(sql, /if p_audience = 'equipo' and not v_is_patient/, 'la persona no escribe solo a profesionales');
assert.match(sql, /mencion fuera de destinatarios/);
assert.match(sql, /ya esta en la hoja de vida/, 'lo que está en la hoja de vida no se edita ni se retira');
for (const f of ['post_case_message', 'edit_case_message', 'retract_case_message', 'promote_case_message', 'case_feed', 'my_case_feed', 'my_case_inbox', 'my_case_unread'])
  assert.match(sql, new RegExp('revoke all on function [^;]*public\\.' + f + '\\([^;]*from public, anon;'), f + ' sin acceso anónimo');
assert.match(sql, /public\.case_to_journal\(uuid, text\) from public, anon, authenticated/, 'auxiliares no se exponen');
assert.match(sql, /public\.case_own_message\(uuid\) from public, anon, authenticated/);
console.log('caso: OK');
