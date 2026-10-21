import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const L = createRequire(import.meta.url)('../assets/linea-tiempo.js');
const E = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const entries = [
  { id: 'a', entry_date: '2026-10-20', kind: 'plan', title: 'Plan nuevo', body: 'Detalle', scope: 'nutricion', author_kind: 'profesional', author_name: 'Camila Soto', author_role: 'nutricionista', created_at: '2026-10-20T10:00:00Z' },
  { id: 'b', entry_date: '2026-10-20', kind: 'nota', title: 'Nota de la tarde', scope: 'bitacora', author_kind: 'paciente', created_at: '2026-10-20T18:00:00Z' },
  { id: 'c', entry_date: '2026-09-02', kind: 'lesion', title: 'Nueva lesión <rodilla>', scope: 'lesiones', author_kind: 'paciente' },
  { id: 'd', entry_date: '2026-08-15', kind: 'raro', title: 'Kind desconocido', scope: 'otro', author_kind: 'admin' }
];
const sessions = [{ id: 's1', date: '2026-09-10', title: 'Control', summary: 'Todo bien' }];

// Una sola lista: más reciente primero; mismo día, la última creada primero; consultas incluidas
const items = L.build(entries, sessions);
assert.deepEqual(items.map(i => i.id), ['b', 'a', 's-s1', 'c', 'd']);
assert.equal(items[2].kind, 'consulta'); assert.equal(items[2].author, 'profesional');
assert.equal(items[4].kind, 'nota', 'tipo desconocido se muestra como nota'); assert.equal(items[4].scope, 'bitacora', 'tema desconocido va a General');
assert.deepEqual(L.build(null, null), []);

// Quién lo registró, según quién mira
assert.equal(L.authorLabel(items[0], 'persona'), 'Tú');
assert.equal(L.authorLabel(items[0], 'pro'), 'La persona');
assert.equal(L.authorLabel(items[1], 'pro'), 'Camila Soto (nutricionista)');
assert.equal(L.authorLabel(items[2], 'persona'), 'Tu equipo');
assert.equal(L.authorLabel(items[4], 'persona'), 'Equipo Sizigia Lab');

// Filtros y facetas
assert.deepEqual(L.filter(items, { topic: 'lesiones' }).map(i => i.id), ['c']);
assert.deepEqual(L.filter(items, { author: 'profesional' }).map(i => i.id), ['a', 's-s1']);
assert.equal(L.filter(items, { topic: 'todos', author: 'todos' }).length, 5);
assert.deepEqual(L.facets(items), { topics: ['bitacora', 'lesiones', 'nutricion'], authors: ['paciente', 'profesional', 'admin'] });

// Por mes
assert.deepEqual(L.byMonth(items).map(m => [m.label, m.items.length]), [['Octubre 2026', 2], ['Septiembre 2026', 2], ['Agosto 2026', 1]]);

// HTML: escapa, muestra solo filtros útiles y el tema
let h = L.html(items, { E, viewer: 'pro', filters: {}, onTopic: 'F.t', onAuthor: 'F.a' });
assert.match(h, /Nueva lesión &lt;rodilla&gt;/); assert.doesNotMatch(h, /<rodilla>/);
assert.match(h, /onclick="F\.t\('lesiones'\)"/); assert.match(h, /Profesionales/);
assert.match(h, /Plan · Nutrición · Camila Soto \(nutricionista\)/);
h = L.html(items, { E, viewer: 'persona', filters: { topic: 'ciclo' }, onTopic: 'F.t', onAuthor: 'F.a' });
assert.match(h, /Nada con estos filtros/);
assert.match(L.html([], { E, viewer: 'persona', filters: {}, onTopic: 'F.t', onAuthor: 'F.a' }), /Aún no hay entradas/);
assert.match(L.html(items, { E, viewer: 'pro', filters: {}, onTopic: 'F.t', onAuthor: 'F.a', limit: 2 }), /3 entradas más antiguas/);

// Migración: única puerta del profesional a la hoja de vida
const sql = readFileSync(new URL('../supabase/migrations/20261030_linea_tiempo.sql', import.meta.url), 'utf8');
assert.match(sql, /create or replace function public\.patient_timeline\(p_patient uuid\) returns jsonb/);
assert.match(sql, /security definer set search_path = public/);
assert.match(sql, /l\.professional_id = v_prof and l\.patient_id = p_patient and l\.revoked_at is null/, 'solo vínculo activo');
assert.match(sql, /s in \('bitacora','lesiones','nutricion','examenes','salud_mental','ciclo'\)/, 'solo temas de la hoja de vida');
assert.match(sql, /raise exception 'sin permiso linea de tiempo'/);
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\) select v_prof, p_patient, s from unnest\(v_scopes\) s/, 'registra un acceso por tema');
assert.match(sql, /j\.scope = any \(v_scopes\)/, 'filtra por los temas autorizados');
assert.match(sql, /revoke all on function public\.patient_timeline\(uuid\) from public, anon/);
assert.match(sql, /grant execute on function public\.patient_timeline\(uuid\) to authenticated/);
assert.doesNotMatch(sql, /create policy/, 'no abre journal_entries por RLS');
console.log('linea-tiempo OK');
