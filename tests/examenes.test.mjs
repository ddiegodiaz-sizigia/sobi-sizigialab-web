import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const X = createRequire(import.meta.url)('../assets/examenes.js');
const T = '2026-10-20';
const doc = { doc_date: '2026-10-01', category: 'laboratorio', title: 'Perfil bioquímico', issuer: 'Lab Central', notes: '', has_file: true };
const row = (o) => ({ marker: 'ferritina', marker_name: 'Ferritina', value: '38', unit: 'ng/mL', ref_low: '15', ref_high: '150', ...o });

// Números con coma decimal
assert.equal(X.num('12,5'), 12.5); assert.equal(X.num(' 4.1 '), 4.1); assert.equal(X.num('1.234,5'), 1234.5);
assert.equal(X.num(''), null); assert.equal(X.num('abc'), null); assert.equal(X.num('12,5,1'), null); assert.equal(X.num(0), 0);

// Rango sugerido por sexo (editable; lo que vale es el del laboratorio)
assert.deepEqual(X.refFor('ferritina', 'femenino'), { lo: 15, hi: 150 });
assert.deepEqual(X.refFor('ferritina', 'masculino'), { lo: 30, hi: 400 });
assert.deepEqual(X.refFor('ferritina', null), { lo: null, hi: null }, 'sin sexo no sugiere rango que depende del sexo');
assert.deepEqual(X.refFor('vitamina_d', null), { lo: 30, hi: 100 });
assert.deepEqual(X.refFor('ldl', 'femenino'), { lo: null, hi: 130 });
assert.deepEqual(X.refFor('otro:zinc', 'femenino'), { lo: null, hi: null });
assert.equal(new Set(X.BIOMARKERS.map(b => b.code)).size, X.BIOMARKERS.length, 'códigos únicos');

// Estado respecto del rango (informativo)
assert.equal(X.status({ value: 12, ref_low: 15, ref_high: 150 }), 'bajo');
assert.equal(X.status({ value: 151, ref_low: 15, ref_high: 150 }), 'alto');
assert.equal(X.status({ value: 150, ref_low: 15, ref_high: 150 }), 'en_rango', 'el borde está en rango');
assert.equal(X.status({ value: 210, ref_low: null, ref_high: 200 }), 'alto');
assert.equal(X.status({ value: 35, ref_low: 40, ref_high: null }), 'bajo');
assert.equal(X.status({ value: 5, ref_low: null, ref_high: null }), null);
assert.equal(X.refText({ ref_low: 15, ref_high: 150 }), '15 a 150'); assert.equal(X.refText({ ref_low: null, ref_high: 200 }), '≤ 200');
assert.equal(X.refText({ ref_low: 40, ref_high: null }), '≥ 40'); assert.equal(X.refText({ ref_low: 0.4, ref_high: '4' }), '0,4 a 4'); assert.equal(X.refText({ ref_low: null, ref_high: null }), 'sin rango');

// Archivo
assert.equal(X.validateFile(null), null);
assert.equal(X.validateFile({ type: 'application/pdf', size: 2e6 }), null);
assert.match(X.validateFile({ type: 'application/zip', size: 10 }), /PDF o una imagen/);
assert.match(X.validateFile({ type: 'image/jpeg', size: X.MAX_BYTES + 1 }), /10 MB/);
assert.equal(X.storagePath('p-1', 'image/jpeg', T, 'abc'), 'p-1/2026-10-20-abc.jpg', 'la ruta empieza por la persona y no usa el nombre original');

// Validación del documento y sus resultados
assert.equal(X.validate(doc, [row()], T), null);
assert.match(X.validate({ ...doc, title: ' ' }, [], T), /nombre/);
assert.match(X.validate({ ...doc, category: 'x' }, [], T), /tipo/);
assert.match(X.validate({ ...doc, doc_date: '2026-10-21' }, [], T), /futura/);
assert.match(X.validate(doc, [row({ value: '' })], T), /valor de Ferritina/);
assert.match(X.validate(doc, [row({ ref_low: 'x' })], T), /rango de Ferritina/);
assert.match(X.validate(doc, [row({ ref_low: '200' })], T), /mínimo del rango es mayor/);
assert.match(X.validate(doc, [row(), row()], T), /repetido/);
assert.match(X.validate(doc, [row({ marker: '', marker_name: '' })], T), /marcador del resultado 1/);
assert.match(X.validate({ ...doc, has_file: false }, [], T), /Adjunta el archivo o anota/);
assert.equal(X.validate({ ...doc, category: 'imagen', has_file: false }, [], T), null, 'un informe puede ir solo con notas');
assert.deepEqual(X.cleanResults([row({ value: '38,5', ref_low: '', unit: ' ' })]), [{ marker: 'ferritina', marker_name: 'Ferritina', value: 38.5, unit: null, ref_low: null, ref_high: 150 }]);
assert.equal(X.customCode('Zinc sérico'), 'otro:zinc_serico');

// Bitácora: mismo texto que document_journal_body() en SQL
const rs = X.cleanResults([row({ value: '12' }), row({ marker: 'tsh', marker_name: 'TSH', value: '2', ref_low: '0,4', ref_high: '4' }), row({ marker: 'vitamina_d', marker_name: 'Vitamina D (25-OH)', value: '21', ref_low: '30', ref_high: '100' })]);
assert.equal(X.journalText(doc, rs), 'Examen de laboratorio · Lab Central. 3 resultados, 2 fuera del rango de referencia: Ferritina, Vitamina D (25-OH).');
assert.equal(X.journalText({ ...doc, issuer: '' }, rs.slice(1, 2)), 'Examen de laboratorio. 1 resultado.');
assert.equal(X.journalText({ ...doc, category: 'imagen', issuer: null }, []), 'Imagen.');
let j = X.journalEntry(null, doc, rs, T);
assert.equal(j.title, 'Nuevo documento: Perfil bioquímico'); assert.equal(j.entry_date, '2026-10-01'); assert.equal(j.kind, 'examen'); assert.equal(j.scope, 'examenes');
j = X.journalEntry({ id: 'a' }, doc, rs, T); assert.equal(j.title, 'Documento actualizado: Perfil bioquímico'); assert.equal(j.entry_date, T);
j = X.deleteEntry({ title: 'Perfil bioquímico', doc_date: '2026-10-01' }, T); assert.equal(j.title, 'Documento eliminado: Perfil bioquímico'); assert.equal(j.body, 'Del 01-10-2026.');

// Biomarcadores en el tiempo: catálogo en su orden, propios al final; último resultado; variación sin juicio
const all = [
  { document_id: 'b', result_date: '2026-10-01', marker: 'ferritina', marker_name: 'Ferritina', value: 38, unit: 'ng/mL', ref_low: 15, ref_high: 150 },
  { document_id: 'a', result_date: '2026-07-01', marker: 'ferritina', marker_name: 'Ferritina', value: 12, unit: 'ng/mL', ref_low: 15, ref_high: 150 },
  { document_id: 'b', result_date: '2026-10-01', marker: 'otro:zinc', marker_name: 'Zinc', value: 90, unit: 'µg/dL', ref_low: null, ref_high: null },
  { document_id: 'b', result_date: '2026-10-01', marker: 'hemoglobina', marker_name: 'Hemoglobina', value: '12.8', unit: 'g/dL', ref_low: 12, ref_high: 16 }
];
const s = X.series(all);
assert.deepEqual(s.map(x => x.marker), ['hemoglobina', 'ferritina', 'otro:zinc']);
assert.equal(s[1].points.length, 2); assert.equal(s[1].last.value, 38); assert.equal(s[1].last.status, 'en_rango'); assert.equal(s[1].points[0].status, 'bajo');
assert.equal(X.changeText(s[1]), 'Subió 26 ng/mL desde el 01-07-2026.');
assert.equal(X.changeText(s[0]), 'Un resultado.');
assert.equal(X.changeText({ unit: 'g/dL', points: [{ date: '2026-07-01', value: 11.6 }, { date: '2026-10-01', value: 12.8 }] }), 'Subió 1,2 g/dL desde el 01-07-2026.');
assert.equal(s[2].last.status, null);
assert.deepEqual(X.sortDocs([{ id: 1, doc_date: '2026-01-01' }, { id: 2, doc_date: '2026-09-01' }]).map(d => d.id), [2, 1]);

// Migración: idempotente, RLS, escritura solo por funciones, bucket privado y acceso del profesional registrado
const sql = readFileSync(new URL('../supabase/migrations/20261026_examenes.sql', import.meta.url), 'utf8');
for (const t of ['documents', 'biomarker_results']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + t + ' '), t + ' idempotente');
  assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'), t + ' con RLS');
}
const policies = [...sql.matchAll(/create policy (\w+) on/g)].map(m => m[1]);
assert.ok(policies.length >= 8);
policies.forEach(p => assert.match(sql, new RegExp('drop policy if exists ' + p + ' on'), p + ' se puede re-ejecutar'));
assert.doesNotMatch(sql, /on public\.(documents|biomarker_results) for (insert|update|delete|all)/, 'nadie escribe las tablas directo');
assert.doesNotMatch(sql, /current_professional_id\(\)[^;]*storage|storage\.objects[^;]*current_professional_id/, 'el profesional no lee el bucket directo');
assert.match(sql, /values \('documentos', 'documentos', false,/, 'bucket privado');
assert.match(sql, /on conflict \(id\) do update/);
assert.match(sql, /split_part\(v_path, '\/', 1\) <> p_patient::text/, 'la ruta del archivo es de la misma persona');
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\) values \(v_prof, p_patient, 'examenes'\)/);
for (const t of ['Nuevo documento: ', 'Documento actualizado: ', 'Documento eliminado: ', ' fuera del rango de referencia: ', ' resultado', 'Examen de laboratorio', 'Receta o indicación'])
  assert.ok(sql.includes(t), 'SQL y journalText comparten el texto: ' + t);
for (const k of Object.keys(X.CATEGORIES)) assert.ok(sql.includes("'" + k + "'"), 'categoría en el check: ' + k);
for (const m of Object.keys(X.MIME)) assert.ok(sql.includes("'" + m + "'"), 'tipo de archivo permitido en el bucket: ' + m);
console.log('examenes: OK');
