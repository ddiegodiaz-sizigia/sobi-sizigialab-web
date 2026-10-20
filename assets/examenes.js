// Exámenes y documentos: subida de archivos (PDF o imagen) al bucket privado 'documentos', visor, resultados
// (biomarcadores) por documento con su evolución, y entrada automática en la hoja de vida (journal_entries, kind
// 'examen'): en Supabase la escriben save_document / delete_document (migración 20261026); en demo, journalText().
// Fuera de rango = fuera del rango de referencia que trae el laboratorio. Informativo, nunca un veredicto clínico.
// Núcleo puro exportado para Node (tests/examenes.test.mjs). La pantalla usa los globals de rueda_final.html
// (state, supabaseClient, currentPatientId, isDemoMode, render, saveState, escapeHtml, todayISO, addDaysISO, fmtDate)
// y trend-chart.js.
(function (root) {
  'use strict';
  var CATEGORIES = { laboratorio: 'Examen de laboratorio', imagen: 'Imagen', informe: 'Informe', receta: 'Receta o indicación', otro: 'Documento' };
  var CAT_HINT = { laboratorio: 'sangre, orina', imagen: 'radiografía, ecografía, resonancia', informe: 'médico, kinesiológico', receta: 'receta o indicación', otro: 'otro' };
  var MAX_BYTES = 10 * 1024 * 1024;
  var MIME = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
  // Rangos generales para adultos, solo como sugerencia editable: lo que vale es el rango impreso en el examen.
  // f/m: rango por sexo. null = sin límite de ese lado. Pendiente de validación por Manuel.
  var BIOMARKERS = [
    { code: 'hemoglobina', name: 'Hemoglobina', unit: 'g/dL', f: [12, 16], m: [13.5, 17.5] },
    { code: 'hematocrito', name: 'Hematocrito', unit: '%', f: [36, 46], m: [41, 53] },
    { code: 'ferritina', name: 'Ferritina', unit: 'ng/mL', f: [15, 150], m: [30, 400] },
    { code: 'hierro', name: 'Hierro sérico', unit: 'µg/dL', ref: [60, 170] },
    { code: 'vitamina_d', name: 'Vitamina D (25-OH)', unit: 'ng/mL', ref: [30, 100] },
    { code: 'vitamina_b12', name: 'Vitamina B12', unit: 'pg/mL', ref: [200, 900] },
    { code: 'glucosa', name: 'Glucosa en ayunas', unit: 'mg/dL', ref: [70, 99] },
    { code: 'hba1c', name: 'Hemoglobina glicosilada (HbA1c)', unit: '%', ref: [4, 5.6] },
    { code: 'colesterol_total', name: 'Colesterol total', unit: 'mg/dL', ref: [null, 200] },
    { code: 'ldl', name: 'Colesterol LDL', unit: 'mg/dL', ref: [null, 130] },
    { code: 'hdl', name: 'Colesterol HDL', unit: 'mg/dL', f: [50, null], m: [40, null] },
    { code: 'trigliceridos', name: 'Triglicéridos', unit: 'mg/dL', ref: [null, 150] },
    { code: 'tsh', name: 'TSH', unit: 'µUI/mL', ref: [0.4, 4] },
    { code: 't4_libre', name: 'T4 libre', unit: 'ng/dL', ref: [0.8, 1.8] },
    { code: 'creatinina', name: 'Creatinina', unit: 'mg/dL', f: [0.5, 1.1], m: [0.7, 1.3] },
    { code: 'ck', name: 'CK (creatina quinasa)', unit: 'U/L', f: [26, 192], m: [39, 308] },
    { code: 'pcr', name: 'Proteína C reactiva (PCR)', unit: 'mg/L', ref: [null, 5] },
    { code: 'testosterona', name: 'Testosterona total', unit: 'ng/dL', f: [15, 70], m: [300, 1000] },
    { code: 'cortisol', name: 'Cortisol (mañana)', unit: 'µg/dL', ref: [6, 23] },
    { code: 'magnesio', name: 'Magnesio', unit: 'mg/dL', ref: [1.7, 2.4] }
  ];
  var BY_CODE = {}; BIOMARKERS.forEach(function (b, k) { BY_CODE[b.code] = Object.assign({ order: k }, b); });

  // ---------- Núcleo puro ----------
  function blank(v) { return v == null || String(v).trim() === ''; }
  function dmy(iso) { return iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4); }
  // Acepta coma decimal ('12,5') y punto. Devuelve número o null.
  function num(v) {
    if (blank(v)) return null;
    var s = String(v).trim().replace(/\s/g, '');
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '');   // 1.234,5
    s = s.replace(',', '.');
    return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
  }
  // Rango sugerido según sexo ('femenino' | 'masculino' | otro). Sin sexo y con rango por sexo: no sugiere.
  function refFor(code, sex) {
    var b = BY_CODE[code];
    if (!b) return { lo: null, hi: null };
    var r = b.ref || (sex === 'femenino' ? b.f : sex === 'masculino' ? b.m : null);
    return r ? { lo: r[0], hi: r[1] } : { lo: null, hi: null };
  }
  function status(r) {
    var v = Number(r.value);
    if (r.ref_low != null && v < Number(r.ref_low)) return 'bajo';
    if (r.ref_high != null && v > Number(r.ref_high)) return 'alto';
    if (r.ref_low == null && r.ref_high == null) return null;
    return 'en_rango';
  }
  function dec(v) { return String(Number(v)).replace('.', ','); }
  function refText(r) {
    if (r.ref_low != null && r.ref_high != null) return dec(r.ref_low) + ' a ' + dec(r.ref_high);
    if (r.ref_low != null) return '≥ ' + dec(r.ref_low);
    if (r.ref_high != null) return '≤ ' + dec(r.ref_high);
    return 'sin rango';
  }

  function validateFile(f) {
    if (!f) return null;
    if (!MIME[f.type]) return 'Sube un PDF o una imagen (JPG, PNG, WEBP o HEIC).';
    if (f.size > MAX_BYTES) return 'El archivo pesa más de 10 MB. Sácale una foto o comprímelo.';
    return null;
  }
  // Devuelve un mensaje de error o null. results: filas del formulario ({marker, marker_name, value, unit, ref_low, ref_high}).
  function validate(doc, results, today) {
    if (blank(doc.title)) return 'Ponle un nombre (por ejemplo: perfil bioquímico, resonancia de rodilla).';
    if (!CATEGORIES[doc.category]) return 'Elige el tipo de documento.';
    if (blank(doc.doc_date)) return 'Indica la fecha del examen.';
    if (today && doc.doc_date > today) return 'La fecha del examen no puede ser futura.';
    var seen = {};
    for (var k = 0; k < results.length; k++) {
      var r = results[k], n = r.marker_name || 'el resultado ' + (k + 1);
      if (blank(r.marker) || blank(r.marker_name)) return 'Elige el marcador del resultado ' + (k + 1) + '.';
      if (seen[r.marker]) return r.marker_name + ' está repetido.';
      seen[r.marker] = true;
      if (num(r.value) == null) return 'Escribe el valor de ' + n + ' (solo número).';
      if (!blank(r.ref_low) && num(r.ref_low) == null) return 'El rango de ' + n + ' debe ser un número.';
      if (!blank(r.ref_high) && num(r.ref_high) == null) return 'El rango de ' + n + ' debe ser un número.';
      if (num(r.ref_low) != null && num(r.ref_high) != null && num(r.ref_low) > num(r.ref_high)) return 'En ' + n + ' el mínimo del rango es mayor que el máximo.';
    }
    if (!results.length && doc.category === 'laboratorio' && !doc.has_file) return 'Adjunta el archivo o anota al menos un resultado.';
    return null;
  }
  // Normaliza las filas del formulario a lo que guarda save_document.
  function cleanResults(results) {
    return results.map(function (r) {
      return { marker: r.marker, marker_name: String(r.marker_name).trim(), value: num(r.value), unit: blank(r.unit) ? null : String(r.unit).trim(), ref_low: num(r.ref_low), ref_high: num(r.ref_high) };
    });
  }
  function customCode(name) {
    return 'otro:' + String(name).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }

  // Misma regla que public.document_journal_body() en la migración.
  function journalText(doc, results) {
    var out = results.filter(function (r) { var s = status(r); return s === 'bajo' || s === 'alto'; });
    var b = CATEGORIES[doc.category] + (blank(doc.issuer) ? '' : ' · ' + String(doc.issuer).trim()) + '.';
    if (results.length) b += ' ' + results.length + (results.length === 1 ? ' resultado' : ' resultados') +
      (out.length ? ', ' + out.length + ' fuera del rango de referencia: ' + out.map(function (r) { return r.marker_name; }).join(', ') : '') + '.';
    return b;
  }
  function journalEntry(prev, doc, results, today) {
    return { entry_date: prev ? today : doc.doc_date, kind: 'examen', title: (prev ? 'Documento actualizado: ' : 'Nuevo documento: ') + String(doc.title).trim(), body: journalText(doc, results), scope: 'examenes' };
  }
  function deleteEntry(doc, today) {
    return { entry_date: today, kind: 'examen', title: 'Documento eliminado: ' + doc.title, body: 'Del ' + dmy(doc.doc_date) + '.', scope: 'examenes' };
  }

  // Ruta en el bucket: <patient_id>/<fecha>-<aleatorio>.<ext>. Sin el nombre original (puede traer datos personales).
  function storagePath(patientId, mime, today, rnd) {
    return patientId + '/' + today + '-' + rnd + '.' + (MIME[mime] || 'bin');
  }

  // Agrupa resultados por marcador: [{marker, name, unit, points:[{date, value, ref_low, ref_high, status, document_id}]}],
  // catálogo primero (en su orden), luego los propios por nombre. Último resultado al final de points.
  function series(results) {
    var map = {};
    results.forEach(function (r) {
      var s = map[r.marker] || (map[r.marker] = { marker: r.marker, name: r.marker_name, unit: r.unit, points: [] });
      s.points.push({ date: r.result_date, value: Number(r.value), ref_low: r.ref_low, ref_high: r.ref_high, unit: r.unit, status: status(r), document_id: r.document_id });
    });
    var list = Object.keys(map).map(function (k) {
      var s = map[k]; s.points.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var last = s.points[s.points.length - 1]; s.name = BY_CODE[k] ? BY_CODE[k].name : s.name; s.unit = last.unit || s.unit; s.last = last;
      return s;
    });
    return list.sort(function (a, b) {
      var ca = BY_CODE[a.marker], cb = BY_CODE[b.marker];
      if (ca && cb) return ca.order - cb.order;
      if (ca || cb) return ca ? -1 : 1;
      return a.name.localeCompare(b.name, 'es');
    });
  }
  // Variación entre los dos últimos resultados, en texto. Sin juicio: solo sube/baja y cuánto.
  function changeText(s) {
    var p = s.points;
    if (p.length < 2) return 'Un resultado.';
    var a = p[p.length - 2], b = p[p.length - 1], d = Math.round((b.value - a.value) * 100) / 100;
    if (d === 0) return 'Igual que el ' + dmy(a.date) + '.';
    return (d > 0 ? 'Subió ' : 'Bajó ') + dec(Math.abs(d)) + (s.unit ? ' ' + s.unit : '') + ' desde el ' + dmy(a.date) + '.';
  }

  function sortDocs(list) {
    return list.slice().sort(function (a, b) { return a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : (a.created_at || '') < (b.created_at || '') ? 1 : -1; });
  }

  var core = { CATEGORIES: CATEGORIES, BIOMARKERS: BIOMARKERS, MAX_BYTES: MAX_BYTES, MIME: MIME, num: num, refFor: refFor, status: status, refText: refText,
    validateFile: validateFile, validate: validate, cleanResults: cleanResults, customCode: customCode, journalText: journalText,
    journalEntry: journalEntry, deleteEntry: deleteEntry, storagePath: storagePath, series: series, changeText: changeText, sortDocs: sortDocs };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { msg: '', formOpen: false, editing: null, draft: null, saving: false, loading: false, fetched: false, viewing: null, urls: {}, open: {} };
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var css = '.ex-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}.ex-meta{font-size:12.5px;color:var(--muted);margin:2px 0 6px;line-height:1.5}' +
    '.ex-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.ex-err{font-size:12px;color:#b91c1c;margin-top:6px}' +
    '.ex-form label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:3px}' +
    '.ex-res{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}.ex-res td,.ex-res th{padding:5px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.ex-res th{font-size:11.5px;color:var(--muted);font-weight:600}' +
    '.ex-st{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap}.ex-st.en_rango{background:#dcfce7;color:#166534}.ex-st.alto,.ex-st.bajo{background:#fef3c7;color:#92400e}.ex-st.none{background:var(--gray-bg);color:var(--muted)}' +
    '.ex-row{display:grid;grid-template-columns:minmax(150px,2fr) 80px 80px 70px 70px auto;gap:6px;align-items:end;margin-top:6px}.ex-row input,.ex-row select{width:100%;min-width:0}' +
    '@media(max-width:640px){.ex-row{grid-template-columns:1fr 1fr 1fr}.ex-row .ex-wide{grid-column:1/-1}}' +
    '.ex-view{margin-top:10px;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#fff}.ex-view iframe{width:100%;height:70vh;border:0;display:block}.ex-view img{max-width:100%;display:block;margin:0 auto}' +
    '.ex-mk{border-top:1px solid var(--line);padding:10px 0}.ex-mk:first-of-type{border-top:0}.ex-mk-h{display:flex;justify-content:space-between;gap:8px;align-items:baseline;flex-wrap:wrap;cursor:pointer}';

  function sex() { return state.profile && state.profile.sex; }
  function lid() { return 'loc-' + Math.random().toString(36).slice(2, 10); }
  function ensure() {
    if (document.getElementById('examenes-css') == null) { var s = document.createElement('style'); s.id = 'examenes-css'; s.textContent = css; document.head.appendChild(s); }
    if (!state.documents) state.documents = isDemoMode ? demoDocs() : [];
    if (!state.biomarkers) state.biomarkers = isDemoMode ? demoResults() : [];
    if (!state.journal) state.journal = [];
    if (!isDemoMode && currentPatientId && !ui.fetched && !ui.loading) load();
  }
  function demoDocs() {
    var t = todayISO();
    return [
      { id: 'demo-lab2', doc_date: addDaysISO(t, -20), category: 'laboratorio', title: 'Perfil bioquímico y hemograma', issuer: 'Laboratorio Clínico', notes: 'Control tras 3 meses de suplementación de hierro y vitamina D.', storage_path: null, created_at: addDaysISO(t, -20) },
      { id: 'demo-rm', doc_date: addDaysISO(t, -60), category: 'imagen', title: 'Resonancia de rodilla derecha', issuer: 'Clínica', notes: 'Tendinopatía rotuliana leve, sin rotura.', storage_path: null, created_at: addDaysISO(t, -60) },
      { id: 'demo-lab1', doc_date: addDaysISO(t, -110), category: 'laboratorio', title: 'Perfil bioquímico y hemograma', issuer: 'Laboratorio Clínico', notes: null, storage_path: null, created_at: addDaysISO(t, -110) }
    ];
  }
  function demoResults() {
    var t = todayISO(), out = [];
    function add(doc, d, code, v) { var b = BY_CODE[code], r = refFor(code, 'femenino'); out.push({ document_id: doc, result_date: addDaysISO(t, d), marker: code, marker_name: b.name, value: v, unit: b.unit, ref_low: r.lo, ref_high: r.hi }); }
    add('demo-lab1', -110, 'hemoglobina', 11.6); add('demo-lab1', -110, 'ferritina', 12); add('demo-lab1', -110, 'vitamina_d', 21); add('demo-lab1', -110, 'tsh', 2.1);
    add('demo-lab2', -20, 'hemoglobina', 12.8); add('demo-lab2', -20, 'ferritina', 38); add('demo-lab2', -20, 'vitamina_d', 34); add('demo-lab2', -20, 'tsh', 1.9); add('demo-lab2', -20, 'glucosa', 86);
    return out;
  }

  async function load() {
    ui.loading = true;
    try {
      var r = await supabaseClient.from('documents').select('*').eq('patient_id', currentPatientId).order('doc_date', { ascending: false });
      if (r.error) { ui.msg = 'Exámenes no disponibles todavía.'; console.warn('documents', r.error.message); }
      else {
        state.documents = r.data || [];
        var b = await supabaseClient.from('biomarker_results').select('document_id,result_date,position,marker,marker_name,value,unit,ref_low,ref_high').eq('patient_id', currentPatientId).order('position');
        state.biomarkers = b.data || [];
      }
    } catch (e) { console.warn('documents', e); }
    ui.loading = false; ui.fetched = true; saveState(); render();
  }
  async function reloadJournal() {
    var jr = await supabaseClient.from('journal_entries').select('*').eq('patient_id', currentPatientId).order('entry_date', { ascending: false });
    if (!jr.error) state.journal = jr.data || [];
  }
  function find(id) { return state.documents.filter(function (d) { return d.id === id; })[0]; }
  function resultsOf(id) { return state.biomarkers.filter(function (r) { return r.document_id === id; }); }
  function done() { saveState(); render(); }

  // ----- Formulario (filas dinámicas: el borrador vive en ui.draft y se sincroniza desde el DOM antes de cada re-render)
  function opt(v, label, sel) { return '<option value="' + E(v) + '"' + (sel ? ' selected' : '') + '>' + E(label) + '</option>'; }
  function newDraft(d) {
    if (!d) return { doc_date: todayISO(), category: 'laboratorio', title: '', issuer: '', notes: '', rows: [] };
    return { doc_date: d.doc_date, category: d.category, title: d.title, issuer: d.issuer || '', notes: d.notes || '', has_file: !!d.storage_path,
      rows: resultsOf(d.id).map(function (r) { return { marker: BY_CODE[r.marker] ? r.marker : 'otro', custom: BY_CODE[r.marker] ? '' : r.marker_name, value: String(r.value), unit: r.unit || '', ref_low: r.ref_low == null ? '' : String(r.ref_low), ref_high: r.ref_high == null ? '' : String(r.ref_high) }; }) };
  }
  function g(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function sync() {
    var d = ui.draft; if (!d || !document.getElementById('ex_title')) return;
    d.doc_date = g('ex_date'); d.category = g('ex_cat'); d.title = g('ex_title'); d.issuer = g('ex_issuer'); d.notes = g('ex_notes');
    d.rows.forEach(function (r, k) { r.marker = g('exr_m' + k); r.custom = g('exr_c' + k); r.value = g('exr_v' + k); r.unit = g('exr_u' + k); r.ref_low = g('exr_lo' + k); r.ref_high = g('exr_hi' + k); });
  }
  function rowHTML(r, k) {
    var used = ui.draft.rows.map(function (x) { return x.marker; });
    var h = '<div class="ex-row"><label class="ex-wide">Marcador<select id="exr_m' + k + '" onchange="SizigiaExamenes.pickMarker(' + k + ')">' + opt('', 'Elige…', !r.marker) +
      BIOMARKERS.map(function (b) { return (used.indexOf(b.code) >= 0 && r.marker !== b.code) ? '' : opt(b.code, b.name, r.marker === b.code); }).join('') + opt('otro', 'Otro…', r.marker === 'otro') + '</select>';
    if (r.marker === 'otro') h += '<input type="text" id="exr_c' + k + '" value="' + E(r.custom) + '" placeholder="Nombre del marcador">';
    h += '</label><label>Valor<input type="text" inputmode="decimal" id="exr_v' + k + '" value="' + E(r.value) + '"></label>';
    h += '<label>Unidad<input type="text" id="exr_u' + k + '" value="' + E(r.unit) + '"></label>';
    h += '<label>Rango mín.<input type="text" inputmode="decimal" id="exr_lo' + k + '" value="' + E(r.ref_low) + '"></label>';
    h += '<label>Rango máx.<input type="text" inputmode="decimal" id="exr_hi' + k + '" value="' + E(r.ref_high) + '"></label>';
    return h + '<button type="button" class="btn small" title="Quitar" onclick="SizigiaExamenes.removeRow(' + k + ')">✕</button></div>';
  }
  function formHTML() {
    var d = ui.draft, editing = ui.editing;
    var h = '<div class="ex-form" style="margin-top:10px"><div class="p-row">';
    h += '<label>Fecha del examen<input type="date" id="ex_date" value="' + E(d.doc_date) + '" max="' + todayISO() + '"></label>';
    h += '<label>Tipo<select id="ex_cat">' + Object.keys(CATEGORIES).map(function (k) { return opt(k, CATEGORIES[k] + ' (' + CAT_HINT[k] + ')', d.category === k); }).join('') + '</select></label>';
    h += '<label style="flex:1;min-width:200px">Nombre<input type="text" id="ex_title" value="' + E(d.title) + '" placeholder="Ej.: perfil bioquímico, resonancia de rodilla"></label></div>';
    h += '<div class="p-row"><label style="min-width:180px">Laboratorio o emisor<input type="text" id="ex_issuer" value="' + E(d.issuer) + '" placeholder="Opcional"></label>';
    if (!d.has_file) h += '<label style="flex:1;min-width:200px">Archivo (PDF o imagen, máx. 10 MB)' + (ui.file ? '<span>' + E(ui.file.name) + ' <button type="button" class="btn small" onclick="SizigiaExamenes.pickFile(null)">Quitar</button></span>' :
      '<input type="file" id="ex_file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic" onchange="SizigiaExamenes.pickFile(this)">') + '</label>';
    else h += '<div class="ex-meta" style="align-self:end">El archivo adjunto se mantiene.</div>';
    h += '</div><div class="p-row"><label style="flex:1">Notas<textarea id="ex_notes" placeholder="Contexto o indicaciones (opcional)">' + E(d.notes) + '</textarea></label></div>';
    h += '<div style="margin-top:8px"><b style="font-size:13px">Resultados</b> <span class="ex-meta">(opcional) Copia el valor y el rango de referencia tal como aparecen en tu examen. Sugerimos un rango general que puedes cambiar.</span></div>';
    h += d.rows.map(rowHTML).join('');
    h += '<div class="ex-actions"><button type="button" class="btn small" onclick="SizigiaExamenes.addRow()">+ Agregar resultado</button></div>';
    h += '<div class="ex-actions"><button class="btn small primary"' + (ui.saving ? ' disabled' : '') + ' onclick="SizigiaExamenes.save()">' + (ui.saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Guardar documento') + '</button><button class="btn small" onclick="SizigiaExamenes.close()">Cancelar</button></div>';
    if (ui.msg) h += '<div class="ex-err">' + E(ui.msg) + '</div>';
    return h + '</div>';
  }

  function stPill(s) { return s ? '<span class="ex-st ' + s + '">' + (s === 'en_rango' ? 'En rango' : s === 'alto' ? 'Sobre el rango' : 'Bajo el rango') + '</span>' : '<span class="ex-st none">Sin rango</span>'; }
  var fmtNum = dec;
  function resultsTable(rs) {
    if (!rs.length) return '';
    return '<table class="ex-res"><tr><th>Marcador</th><th>Valor</th><th>Referencia</th><th></th></tr>' + rs.map(function (r) {
      return '<tr><td>' + E(r.marker_name) + '</td><td><b>' + fmtNum(r.value) + '</b> ' + E(r.unit || '') + '</td><td>' + E(refText(r)) + '</td><td>' + stPill(status(r)) + '</td></tr>';
    }).join('') + '</table>';
  }
  function viewer(d) {
    var u = ui.urls[d.id];
    if (!u) return '<div class="ex-view"><div class="tc-empty">Abriendo archivo…</div></div>';
    if (u === 'error') return '<div class="ex-err">No se pudo abrir el archivo. Reintenta.</div>';
    var body = /^image\//.test(d.mime_type || '') ? '<img src="' + E(u) + '" alt="' + E(d.title) + '">' : '<iframe src="' + E(u) + '" title="' + E(d.title) + '"></iframe>';
    return '<div class="ex-view">' + body + '</div><div class="ex-meta"><a href="' + E(u) + '" target="_blank" rel="noopener">Abrir en otra pestaña</a> · el enlace dura 5 minutos.</div>';
  }
  function docCard(d) {
    var rs = resultsOf(d.id).slice().sort(function (a, b) { return (a.position || 0) - (b.position || 0); });
    var h = '<div class="card" style="margin-bottom:12px;"><div class="ex-head"><div><h3 style="margin:0">' + E(d.title) + '</h3>';
    h += '<div class="ex-meta">' + fmtDate(d.doc_date) + (d.issuer ? ' · ' + E(d.issuer) : '') + (d.created_by_kind === 'admin' ? ' · subido por el equipo Sizigia' : '') + '</div></div><span class="p-pill">' + E(CATEGORIES[d.category]) + '</span></div>';
    if (ui.editing === d.id) return h + formHTML() + '</div>';
    if (d.notes) h += '<div style="font-size:13px;white-space:pre-wrap;line-height:1.5">' + E(d.notes) + '</div>';
    h += resultsTable(rs);
    if (ui.viewing === d.id) h += viewer(d);
    h += '<div class="ex-actions">';
    if (d.storage_path || d.local_url) h += '<button class="btn small" onclick="SizigiaExamenes.view(\'' + E(d.id) + '\')">' + (ui.viewing === d.id ? 'Ocultar archivo' : 'Ver archivo') + '</button>';
    h += '<button class="btn small" onclick="SizigiaExamenes.edit(\'' + E(d.id) + '\')">Editar</button>';
    h += '<button class="btn small" onclick="SizigiaExamenes.remove(\'' + E(d.id) + '\')">Eliminar</button></div>';
    if (ui.msgFor === d.id && ui.msg) h += '<div class="ex-err">' + E(ui.msg) + '</div>';
    return h + '</div>';
  }

  function markersCard() {
    var list = series(state.biomarkers);
    if (!list.length) return '';
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Mis biomarcadores</h3><div class="card-sub">Último resultado de cada marcador y cómo ha cambiado. Toca uno para ver su evolución.</div>';
    list.forEach(function (s) {
      var l = s.last, open = !!ui.open[s.marker];
      h += '<div class="ex-mk"><div class="ex-mk-h" onclick="SizigiaExamenes.toggle(\'' + E(s.marker) + '\')"><div><b>' + E(s.name) + '</b> <span class="ex-meta">' + fmtNum(l.value) + ' ' + E(s.unit || '') + ' · ' + fmtDate(l.date) + '</span></div>' + stPill(l.status) + '</div>';
      h += '<div class="ex-meta" style="margin:2px 0 0">' + E(changeText(s)) + ' Referencia: ' + E(refText(l)) + '.</div>';
      if (open) {
        if (s.points.length >= 2 && root.SizigiaCharts) {
          var first = s.points[0].date, span = Math.round((Date.parse(todayISO()) - Date.parse(first)) / 86400000) + 1;
          var vals = s.points.map(function (p) { return p.value; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
          h += '<div style="max-width:560px">' + root.SizigiaCharts.build(s.points.map(function (p) { return { iso: p.date, value: p.value }; }), { days: span, today: todayISO(), label: s.name, unit: s.unit || '', decimals: hi - lo < 5 ? 1 : 0, minSpan: Math.max(0.5, (hi || 1) * 0.1), clampMin: 0 }) + '</div>';
        }
        h += '<table class="ex-res">' + s.points.slice().reverse().map(function (p) { return '<tr><td>' + fmtDate(p.date) + '</td><td><b>' + fmtNum(p.value) + '</b> ' + E(p.unit || '') + '</td><td>' + E(refText(p)) + '</td><td>' + stPill(p.status) + '</td></tr>'; }).join('') + '</table>';
      }
      h += '</div>';
    });
    return h + '<div class="tc-note">“Sobre” o “bajo el rango” compara con el rango de referencia anotado en cada examen. Es informativo: interprétalo con tu médico.</div></div>';
  }

  function tab() {
    ensure();
    var docs = sortDocs(state.documents);
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Exámenes y documentos</h3><div class="card-sub">Guarda tus exámenes, imágenes e informes en un solo lugar y anota sus resultados para ver cómo cambian. Cada documento queda en tu hoja de vida. Tu equipo lo ve solo si autorizas el permiso de exámenes.</div>';
    h += '<div class="tc-note">Registro informativo. No reemplaza la interpretación de tu médico.</div>';
    if (ui.formOpen && !ui.editing) h += formHTML();
    else if (!ui.editing) h += '<div style="margin-top:10px"><button class="btn small primary" onclick="SizigiaExamenes.openForm()">Subir documento</button></div>';
    if (!ui.formOpen && !ui.editing && ui.msg && !ui.msgFor) h += '<div class="ex-err">' + E(ui.msg) + '</div>';
    h += '</div>';
    if (ui.loading && !docs.length) return h + '<div class="tc-empty">Cargando documentos…</div>';
    h += markersCard();
    if (!docs.length) return h + '<div class="tc-empty">Todavía no tienes documentos.</div>';
    return h + '<h3 style="margin:6px 0 10px">Documentos (' + docs.length + ')</h3>' + docs.map(docCard).join('');
  }

  // ---------- Acciones ----------
  function openForm() { ui.formOpen = true; ui.editing = null; ui.file = null; ui.draft = newDraft(null); ui.msg = ''; ui.msgFor = null; render(); }
  function edit(id) { ui.formOpen = true; ui.editing = id; ui.file = null; ui.draft = newDraft(find(id)); ui.msg = ''; ui.msgFor = null; ui.viewing = null; render(); }
  function close() { ui.formOpen = false; ui.editing = null; ui.draft = null; ui.file = null; ui.msg = ''; render(); }
  // El archivo se guarda en memoria al elegirlo: el formulario se re-dibuja al agregar filas y el input perdería la selección.
  function pickFile(el) {
    sync();
    var f = el && el.files && el.files[0];
    ui.msg = validateFile(f) || '';
    ui.file = f && !ui.msg ? f : null;
    render();
  }
  function addRow() { sync(); ui.draft.rows.push({ marker: '', custom: '', value: '', unit: '', ref_low: '', ref_high: '' }); render(); }
  function removeRow(k) { sync(); ui.draft.rows.splice(k, 1); render(); }
  function pickMarker(k) {
    sync();
    var r = ui.draft.rows[k], b = BY_CODE[r.marker];
    if (b) { var ref = refFor(b.code, sex()); r.unit = b.unit; r.ref_low = ref.lo == null ? '' : String(ref.lo); r.ref_high = ref.hi == null ? '' : String(ref.hi); }
    render();
  }
  function draftResults() {
    return ui.draft.rows.map(function (r) {
      var other = r.marker === 'otro';
      return { marker: other ? (blank(r.custom) ? '' : customCode(r.custom)) : r.marker, marker_name: other ? String(r.custom || '').trim() : (BY_CODE[r.marker] ? BY_CODE[r.marker].name : ''), value: r.value, unit: r.unit, ref_low: r.ref_low, ref_high: r.ref_high };
    });
  }

  async function save() {
    if (ui.saving) return;
    sync();
    var d = ui.draft, prev = ui.editing ? find(ui.editing) : null, file = d.has_file ? null : ui.file;
    var raw = draftResults(), doc = { doc_date: d.doc_date, category: d.category, title: d.title, issuer: d.issuer, notes: d.notes, has_file: d.has_file || !!file };
    var err = validateFile(file) || validate(doc, raw, todayISO());
    if (err) { ui.msg = err; return render(); }
    var results = cleanResults(raw);
    ui.saving = true; ui.msg = ''; render();
    try {
      if (isDemoMode || !currentPatientId) saveLocal(prev, doc, results, file);
      else await saveRemote(prev, doc, results, file);
      ui.formOpen = false; ui.editing = null; ui.draft = null; ui.file = null;
    } catch (e) { console.warn('save_document', e); ui.msg = 'No se pudo guardar. Reintenta en un momento.'; }
    ui.saving = false; done();
  }
  function saveLocal(prev, doc, results, file) {
    var row = Object.assign(prev || { id: lid(), created_at: new Date().toISOString(), created_by_kind: 'paciente', storage_path: null }, {
      doc_date: doc.doc_date, category: doc.category, title: doc.title.trim(), issuer: blank(doc.issuer) ? null : doc.issuer.trim(), notes: blank(doc.notes) ? null : doc.notes.trim() });
    if (file && !row.local_url) { row.local_url = URL.createObjectURL(file); row.mime_type = file.type; row.file_name = file.name; }
    if (!prev) state.documents.unshift(row);
    state.biomarkers = state.biomarkers.filter(function (r) { return r.document_id !== row.id; }).concat(results.map(function (r, k) { return Object.assign({ document_id: row.id, result_date: row.doc_date, position: k }, r); }));
    var j = journalEntry(prev, doc, results, todayISO());
    state.journal.unshift(Object.assign({ id: lid(), author_kind: 'paciente' }, j));
  }
  async function saveRemote(prev, doc, results, file) {
    var path = null, bucket = supabaseClient.storage.from('documentos');
    if (file) {
      path = storagePath(currentPatientId, file.type, todayISO(), Math.random().toString(36).slice(2, 12));
      var up = await bucket.upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
    }
    var p = { id: prev ? prev.id : null, doc_date: doc.doc_date, category: doc.category, title: doc.title, issuer: doc.issuer, notes: doc.notes,
      storage_path: path, file_name: file ? file.name : null, mime_type: file ? file.type : null, size_bytes: file ? file.size : null };
    var r = await supabaseClient.rpc('save_document', { p_patient: currentPatientId, p_doc: p, p_results: results });
    if (r.error) { if (path) await bucket.remove([path]); throw r.error; }
    ui.fetched = false; await load(); await reloadJournal();
  }

  async function remove(id) {
    var d = find(id);
    if (!d || !confirm('¿Eliminar "' + d.title + '"' + (d.storage_path || d.local_url ? ' y su archivo' : '') + '? Quedará registrado en tu hoja de vida.')) return;
    if (isDemoMode || !currentPatientId) {
      state.documents = state.documents.filter(function (x) { return x.id !== id; });
      state.biomarkers = state.biomarkers.filter(function (r) { return r.document_id !== id; });
      state.journal.unshift(Object.assign({ id: lid(), author_kind: 'paciente' }, deleteEntry(d, todayISO())));
      return done();
    }
    var r = await supabaseClient.rpc('delete_document', { p_id: id });
    if (r.error) { ui.msg = 'No se pudo eliminar. Reintenta.'; ui.msgFor = id; return render(); }
    if (r.data) { var rm = await supabaseClient.storage.from('documentos').remove([r.data]); if (rm.error) console.warn('storage remove', rm.error.message); }
    state.documents = state.documents.filter(function (x) { return x.id !== id; });
    state.biomarkers = state.biomarkers.filter(function (x) { return x.document_id !== id; });
    await reloadJournal(); done();
  }

  async function view(id) {
    if (ui.viewing === id) { ui.viewing = null; return render(); }
    var d = find(id); ui.viewing = id;
    if (d.local_url) { ui.urls[id] = d.local_url; return render(); }
    delete ui.urls[id]; render();
    var r = await supabaseClient.storage.from('documentos').createSignedUrl(d.storage_path, 300);
    ui.urls[id] = r.error ? 'error' : r.data.signedUrl;
    render();
  }

  root.SizigiaExamenes = Object.assign({}, core, {
    tab: tab, openForm: openForm, edit: edit, close: close, addRow: addRow, removeRow: removeRow, pickMarker: pickMarker, save: save, remove: remove, view: view, pickFile: pickFile,
    toggle: function (m) { ui.open[m] = !ui.open[m]; render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
