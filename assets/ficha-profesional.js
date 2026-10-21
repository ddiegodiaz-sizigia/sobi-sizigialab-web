// Ficha de una persona para el profesional (equipo.html): lesiones, exámenes y nutrición, según los permisos que la
// persona le dio. Lista: my_linked_patients() (solo nombre y permisos; migración 20261028). Cada sección se carga recién
// al abrirla con patient_lesiones / patient_examenes / patient_nutricion, que validan el permiso y registran el acceso.
// Un profesional con permiso 'nutricion' puede editar el plan (set_nutrition_plan con p_patient; queda a su nombre).
// El archivo de un examen se abre con open_document_file (migración 20261031): registra el acceso y firma 5 minutos.
// Pestaña 'Caso' (permiso 'equipo'): conversación del equipo, la dibuja assets/caso.js (case_feed registra el acceso).
// Reutiliza los núcleos puros de lesiones.js, examenes.js y nutricion.js: mismas reglas que ve la persona.
// Núcleo puro exportado para Node (tests/ficha-profesional.test.mjs).
(function (root) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var L = node ? require('./lesiones.js') : root.SizigiaLesiones;
  var X = node ? require('./examenes.js') : root.SizigiaExamenes;
  var N = node ? require('./nutricion.js') : root.SizigiaNutricion;

  var SECTIONS = [
    { key: 'equipo', label: 'Caso', rpc: 'case_feed' },
    { key: 'lesiones', label: 'Lesiones', rpc: 'patient_lesiones' },
    { key: 'examenes', label: 'Exámenes', rpc: 'patient_examenes' },
    { key: 'nutricion', label: 'Nutrición', rpc: 'patient_nutricion' }
  ];
  // Portada (fase 3): resumen de 10 segundos y línea de tiempo única (assets/linea-tiempo.js, patient_timeline).
  // Aparece primero si el profesional tiene al menos un tema de la hoja de vida.
  var LT = node ? require('./linea-tiempo.js') : root.SizigiaLinea;
  var TIMELINE_SCOPES = ['bitacora', 'lesiones', 'nutricion', 'examenes', 'salud_mental', 'ciclo'];
  var PORTADA = { key: 'portada', label: 'Portada', rpc: 'patient_timeline' };
  var BY_KEY = { portada: PORTADA }; SECTIONS.forEach(function (s) { BY_KEY[s.key] = s; });

  // ---------- Núcleo puro ----------
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function sections(scopes) {
    var sc = scopes || [], list = SECTIONS.filter(function (s) { return sc.indexOf(s.key) >= 0; });
    return sc.some(function (s) { return TIMELINE_SCOPES.indexOf(s) >= 0; }) ? [PORTADA].concat(list) : list;
  }
  // Personas con alguna sección de ficha que no están en el panel del semáforo (no dieron ese permiso).
  function extraPeople(linked, panelIds) {
    var inPanel = {}; (panelIds || []).forEach(function (id) { inPanel[id] = true; });
    return (linked || []).filter(function (p) { return !inPanel[p.patient_id] && sections(p.scopes).length; });
  }

  // patient_lesiones → abiertas primero, con el resumen que ve la persona.
  function lesionesView(data, today) {
    var pain = {};
    (data.pain || []).forEach(function (p) { (pain[p.injury_id] = pain[p.injury_id] || []).push({ log_date: p.log_date, eva: Number(p.eva) }); });
    return L.sortInjuries(data.injuries || []).map(function (i) {
      return { injury: i, name: L.injuryName(i), status: L.STATUS[i.status], open: L.isOpen(i), summary: L.summary(i, pain[i.id], today), pain: pain[i.id] || [] };
    });
  }
  // patient_examenes → documentos con sus resultados y la serie por marcador.
  function examenesView(data) {
    var res = data.results || [], byDoc = {};
    res.forEach(function (r) { (byDoc[r.document_id] = byDoc[r.document_id] || []).push(r); });
    return {
      docs: X.sortDocs(data.documents || []).map(function (d) { return { doc: d, category: X.CATEGORIES[d.category] || d.category, results: byDoc[d.id] || [] }; }),
      series: X.series(res),
      outOfRange: X.series(res).filter(function (s) { return s.last.status === 'alto' || s.last.status === 'bajo'; }).map(function (s) { return s.name; })
    };
  }
  // Portada: in = { timeline (patient_timeline), lesiones, examenes (sus RPC, o null sin permiso), row (fila del panel o null) }.
  function portadaView(input, today) {
    var row = input.row, ex = input.examenes ? examenesView(input.examenes) : null;
    return {
      sem: row ? { level: row.level, reasons: (row.sem.reasons || []).map(function (r) { return r.text; }), adherence: row.adherence ? row.adherence.done + '/' + row.adherence.expected : null, weekly: row.frequency === 'semanal' } : null,
      injuries: input.lesiones ? lesionesView(input.lesiones, today).filter(function (x) { return x.open; }).map(function (x) { return { name: x.name, status: x.status, text: x.summary.text }; }) : null,
      exams: ex ? { outOfRange: ex.outOfRange, last: ex.docs[0] ? { title: ex.docs[0].doc.title, date: ex.docs[0].doc.doc_date } : null } : null,
      scopes: (input.timeline && input.timeline.scopes) || [],
      items: LT.build((input.timeline && input.timeline.entries) || [], [])
    };
  }
  // patient_nutricion → plan vigente, adherencia 7 y 28 días, peso y composición.
  function nutricionView(data, today) {
    var plans = data.plans || [], logs = {}, body = {};
    (data.logs || []).forEach(function (g) { (logs[g.log_date] = logs[g.log_date] || {})[g.meal_key] = Number(g.status); });
    (data.body || []).forEach(function (b) { body[b.entry_date] = b; });
    var plan = N.planFor(plans, today) || plans.slice().sort(function (a, b) { return (b.created_at || '') < (a.created_at || '') ? -1 : 1; })[0] || null;
    return { plan: plan, versions: plans.length, a7: N.adherence(plans, logs, today, 7), a28: N.adherence(plans, logs, today, 28), body: N.bodySummary(body, today) };
  }

  // Datos de ejemplo para equipo.html?demo=1 (sin red). ids = personas del panel de ejemplo.
  function demoLinked(panel) {
    var out = (panel || []).map(function (p, k) {
      var sc = ['semaforo'];
      if (k % 2 === 0) sc.push('lesiones');
      if (k % 2 === 0 || p.patient_id === 'demo-1') sc.push('equipo');
      if (k % 3 === 0) sc.push('examenes', 'nutricion');
      return { patient_id: p.patient_id, patient_name: p.patient_name, scopes: sc };
    });
    return out.concat([
      { patient_id: 'demo-n1', patient_name: 'Paula Ríos', scopes: ['nutricion', 'examenes'] },
      { patient_id: 'demo-n2', patient_name: 'Tomás Herrera', scopes: ['nutricion'] }
    ]);
  }
  // pid 'demo-1' (Matías, alerta roja por dolor 7/10 en el panel): su rodilla vuelve a subir hoy, para que panel y ficha cuenten lo mismo.
  function demoData(scope, today, pid) {
    var d = function (k) { return addDays(today, -k); };
    if (scope === 'lesiones') return {
      injuries: [
        { id: 'i1', onset_date: d(12), zone: 'Rodilla', side: 'derecha', title: 'Molestia al aterrizar saltos', eva_initial: 5, treating: 'Kinesióloga del club', status: 'rehabilitacion', discharge_date: null, notes: 'Excéntricos 3x/semana.' },
        { id: 'i2', onset_date: d(150), zone: 'Tobillo / pie', side: 'izquierda', title: 'Esguince grado I', eva_initial: 6, treating: null, status: 'alta', discharge_date: d(122), notes: null }],
      pain: (pid === 'demo-1' ? [5, 5, 4, 4, 3, 3, 7] : [5, 5, 4, 4, 3, 3, 2]).map(function (v, k) { return { injury_id: 'i1', log_date: d(6 - k), eva: v }; })
    };
    if (scope === 'portada') return {
      scopes: ['bitacora', 'examenes', 'lesiones', 'nutricion'],
      entries: [
        { id: 'j1', entry_date: d(1), kind: 'plan', title: 'Plan de alimentación actualizado', body: 'Colación de la tarde: yogur con avena.', scope: 'nutricion', author_kind: 'profesional', author_name: 'Camila Soto', author_role: 'nutricionista', created_at: d(1) + 'T15:00:00Z' },
        { id: 'j2', entry_date: d(3), kind: 'plan', title: 'Registro: deportivo diario', body: 'Sueño, fatiga, ánimo, dolor y carga de cada sesión. Definido por su coach.', scope: 'bitacora', author_kind: 'profesional', author_name: 'Coach Ejemplo', author_role: 'entrenador', created_at: d(3) + 'T10:00:00Z' },
        { id: 'j3', entry_date: d(9), kind: 'examen', title: 'Examen: Perfil bioquímico y hemograma', body: 'Ferritina bajo el rango del laboratorio.', scope: 'examenes', author_kind: 'paciente', created_at: d(9) + 'T12:00:00Z' },
        { id: 'j4', entry_date: d(12), kind: 'lesion', title: 'Nueva lesión: Rodilla (lado derecho)', body: 'Molestia al aterrizar saltos. EVA inicial 5/10. Tratante: Kinesióloga del club.', scope: 'lesiones', author_kind: 'paciente', created_at: d(12) + 'T09:00:00Z' },
        { id: 'j5', entry_date: d(40), kind: 'objetivo', title: 'Llegar al torneo regional en forma', body: 'Foco: sueño y recuperación entre sesiones.', scope: 'bitacora', author_kind: 'paciente', created_at: d(40) + 'T09:00:00Z' },
        { id: 'j6', entry_date: d(122), kind: 'lesion', title: 'Alta: Tobillo / pie (lado izquierdo)', body: 'Esguince grado I.', scope: 'lesiones', author_kind: 'paciente', created_at: d(122) + 'T09:00:00Z' }
      ]
    };
    if (scope === 'examenes') {
      var r = function (doc, k, code, name, v, unit, lo, hi) { return { document_id: doc, result_date: d(k), marker: code, marker_name: name, value: v, unit: unit, ref_low: lo, ref_high: hi }; };
      return {
        documents: [{ id: 'x2', doc_date: d(20), category: 'laboratorio', title: 'Perfil bioquímico y hemograma', issuer: 'Laboratorio Clínico', notes: null, has_file: true },
          { id: 'x1', doc_date: d(110), category: 'laboratorio', title: 'Perfil bioquímico', issuer: 'Laboratorio Clínico', notes: null, has_file: false }],
        results: [r('x1', 110, 'ferritina', 'Ferritina', 12, 'ng/mL', 15, 150), r('x1', 110, 'vitamina_d', 'Vitamina D (25-OH)', 21, 'ng/mL', 30, 100),
          r('x2', 20, 'ferritina', 'Ferritina', 38, 'ng/mL', 15, 150), r('x2', 20, 'vitamina_d', 'Vitamina D (25-OH)', 27, 'ng/mL', 30, 100), r('x2', 20, 'glucosa', 'Glucosa en ayunas', 86, 'mg/dL', 70, 99)]
      };
    }
    var logs = [];
    ['2221', '2212', '221', '2222', '1202', '2221', '2222', '22', '2122', '2221'].forEach(function (s, k) {
      s.split('').forEach(function (c, j) { logs.push({ log_date: d(9 - k), meal_key: 'm' + (j + 1), status: Number(c) }); });
    });
    return {
      plans: [{ id: 'np1', valid_from: d(40), created_at: d(40) + 'T12:00:00Z', author_kind: 'paciente', notes: 'Agua: 2 litros.', meals: [
        { key: 'm1', name: 'Desayuno', time: '07:30', guide: 'Avena con yogur y fruta.' }, { key: 'm2', name: 'Almuerzo', time: '13:30', guide: '½ plato verduras, ¼ proteína, ¼ carbohidrato.' },
        { key: 'm3', name: 'Once', time: '17:30', guide: 'Pan integral con huevo.' }, { key: 'm4', name: 'Cena', time: '20:30', guide: '' }] }],
      logs: logs,
      body: [{ entry_date: d(45), weight_kg: 78.2, body_fat_pct: 24.1, muscle_mass_kg: 33.9 }, { entry_date: d(30), weight_kg: 77.4, body_fat_pct: 23.6 }, { entry_date: d(3), weight_kg: 76.5, body_fat_pct: 22.8, muscle_mass_kg: 34.2 }]
    };
  }

  var core = { SECTIONS: SECTIONS, PORTADA: PORTADA, TIMELINE_SCOPES: TIMELINE_SCOPES, sections: sections, extraPeople: extraPeople, lesionesView: lesionesView, examenesView: examenesView, nutricionView: nutricionView, portadaView: portadaView, demoLinked: demoLinked, demoData: demoData };
  if (node) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { el: null, sb: null, demo: false, linked: [], panelIds: [], open: null, tab: null, data: {}, loading: false, err: '', draft: null, msg: '', busy: false, lt: { topic: 'todos', author: 'todos' }, files: {} };
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var css = '.fp-back{position:fixed;inset:0;background:rgba(19,26,23,.35);z-index:50;display:flex;justify-content:flex-end}' +
    '.fp-sheet{background:var(--canvas);width:min(720px,100%);height:100%;overflow-y:auto;padding:18px 18px 40px;box-shadow:-8px 0 24px rgba(0,0,0,.12)}' +
    '.fp-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px}.fp-top h2{margin:0;font-size:18px}' +
    '.fp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px}.fp-tab{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 13px;font-size:13px;cursor:pointer;font-family:inherit}.fp-tab.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}' +
    '.fp-card{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:10px}.fp-card h4{margin:0 0 4px;font-size:14px}' +
    '.fp-meta{font-size:12.5px;color:var(--muted);line-height:1.5}.fp-pill{font-size:11.5px;border-radius:999px;padding:2px 8px;background:#f1f0ee;white-space:nowrap}' +
    '.fp-pill.activa{background:#fee2e2;color:#991b1b}.fp-pill.rehabilitacion{background:#fef3c7;color:#92400e}.fp-pill.alta,.fp-pill.en_rango{background:#dcfce7;color:#166534}.fp-pill.alto,.fp-pill.bajo{background:#fef3c7;color:#92400e}' +
    '.fp-row{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.fp-tbl{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}.fp-tbl td,.fp-tbl th{padding:4px 6px;border-bottom:1px solid var(--line);text-align:left}.fp-tbl th{font-size:11.5px;color:var(--muted);font-weight:600}' +
    '.fp-bar{height:6px;background:#eeece9;border-radius:3px;overflow:hidden;margin-top:3px}.fp-bar i{display:block;height:100%;background:var(--accent)}' +
    '.fp-ed{display:grid;grid-template-columns:minmax(110px,1fr) 88px minmax(150px,2fr) auto;gap:6px;align-items:end;margin-top:6px}.fp-ed input{margin:0}.fp-ed label{font-size:11.5px;color:var(--muted)}' +
    '@media(max-width:560px){.fp-ed{grid-template-columns:1fr 88px auto}.fp-ed .w{grid-column:1/-1;order:3}}' +
    '.fp-list{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden}.fp-item{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid var(--line)}.fp-item:first-child{border-top:0}' +
    '.fp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}.fp-grid .fp-card{margin-bottom:0}.fp-h3{font-size:14px;margin:18px 0 8px}' +
    '.fp-err{font-size:12.5px;color:#b91c1c;margin-top:6px}.fp-ok{font-size:12.5px;color:#065f46;margin-top:6px}' +
    '.fp-sheet .tc{display:block;margin-top:8px}.fp-sheet .tc-note,.fp-sheet .tc-empty{font-size:11.5px;color:var(--muted);line-height:1.4}';

  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dmy(iso) { return iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4) : ''; }
  function dec(v) { return String(Math.round(Number(v) * 10) / 10).replace('.', ','); }
  function person(id) { return ui.linked.filter(function (p) { return p.patient_id === id; })[0]; }
  function ensureCss() { if (!document.getElementById('ficha-css')) { var s = document.createElement('style'); s.id = 'ficha-css'; s.textContent = css; document.head.appendChild(s); } }
  function chart(points, opts) { return root.SizigiaCharts && points.length >= 2 ? '<div style="max-width:520px">' + root.SizigiaCharts.build(points, opts) + '</div>' : ''; }

  // Botón para la fila del panel del coach; vacío si la persona no dio permisos de ficha.
  function button(id) {
    var p = person(id), s = p ? sections(p.scopes) : [];
    if (!s.length) return '';
    return '<div class="pc-sec"><h4>Ficha</h4><div class="pc-small">' + E(s.map(function (x) { return x.label; }).join(', ')) + '</div><div class="pc-acts"><button class="btn" onclick="SizigiaFicha.open(\'' + E(id) + '\')">Ver ficha</button></div></div>';
  }

  function listHTML() {
    var extra = extraPeople(ui.linked, ui.panelIds);
    if (!extra.length) return '';
    return '<h3 style="font-size:15px;margin:22px 0 4px">Otras personas</h3><div class="note" style="margin-bottom:10px">Te dieron acceso a su ficha, pero no a su semáforo.</div><div class="fp-list">' + extra.map(function (p) {
      return '<div class="fp-item"><div><b>' + E(p.patient_name) + '</b><div class="fp-meta">' + E(sections(p.scopes).map(function (x) { return x.label; }).join(', ')) + '</div></div><button class="btn" onclick="SizigiaFicha.open(\'' + E(p.patient_id) + '\')">Ver ficha</button></div>';
    }).join('') + '</div>';
  }

  function lesionesHTML(v) {
    if (!v.length) return '<div class="fp-card fp-meta">No tiene lesiones registradas.</div>';
    return v.map(function (x) {
      var i = x.injury, s = x.summary;
      return '<div class="fp-card"><div class="fp-row"><div><h4>' + E(x.name) + '</h4><div class="fp-meta">' + E(i.title) + '</div></div><span class="fp-pill ' + E(i.status) + '">' + E(x.status) + '</span></div>' +
        '<div class="fp-meta">Desde el ' + dmy(i.onset_date) + (i.status === 'alta' ? ' · alta el ' + dmy(i.discharge_date) + ' (' + s.days + ' días)' : ' · hace ' + s.days + ' días') + (i.treating ? ' · Tratante: ' + E(i.treating) : '') + '<br>' + E(s.text) + '</div>' +
        (i.notes ? '<div style="font-size:13px;margin-top:4px;white-space:pre-wrap">' + E(i.notes) + '</div>' : '') +
        (x.open ? chart(x.pain.map(function (p) { return { iso: p.log_date, value: p.eva }; }), { metric: 'pain', days: 14, today: today(), label: 'Dolor (EVA)' }) : '') + '</div>';
    }).join('');
  }
  // Archivo del examen: open_document_file valida el permiso, registra el acceso y habilita el archivo; URL de 5 minutos.
  function fileHTML(id) {
    var u = ui.files[id];
    if (!u) return '<button class="btn" onclick="SizigiaFicha.openDoc(\'' + E(id) + '\')">Ver archivo</button>';
    if (u === 'cargando') return '<span class="fp-meta">Abriendo…</span>';
    if (u === 'demo') return '<span class="fp-meta">En la demo no hay archivo real.</span>';
    if (u === 'error') return '<button class="btn" onclick="SizigiaFicha.openDoc(\'' + E(id) + '\')">Reintentar</button>';
    return '<a class="btn" target="_blank" rel="noopener" href="' + E(u) + '">Abrir archivo</a>';
  }
  async function openDoc(id) {
    if (ui.demo) { ui.files[id] = 'demo'; return render(); }
    ui.files[id] = 'cargando'; render();
    var r = await ui.sb.rpc('open_document_file', { p_doc: id });
    var s = r.error ? r : await ui.sb.storage.from('documentos').createSignedUrl(r.data, 300);
    ui.files[id] = s.error ? 'error' : s.data.signedUrl;
    render();
  }
  function stPill(s) { return s ? '<span class="fp-pill ' + s + '">' + (s === 'en_rango' ? 'En rango' : s === 'alto' ? 'Sobre el rango' : 'Bajo el rango') + '</span>' : '<span class="fp-pill">Sin rango</span>'; }
  function examenesHTML(v) {
    if (!v.docs.length) return '<div class="fp-card fp-meta">No tiene documentos.</div>';
    var h = '';
    if (v.series.length) h += '<div class="fp-card"><h4>Biomarcadores (último resultado)</h4>' + (v.outOfRange.length ? '<div class="fp-meta">Fuera del rango de su laboratorio: ' + E(v.outOfRange.join(', ')) + '.</div>' : '') +
      '<table class="fp-tbl"><tr><th>Marcador</th><th>Último</th><th>Referencia</th><th>Cambio</th><th></th></tr>' + v.series.map(function (s) {
        return '<tr><td>' + E(s.name) + '</td><td><b>' + dec(s.last.value) + '</b> ' + E(s.unit || '') + '<div class="fp-meta">' + dmy(s.last.date) + '</div></td><td>' + E(X.refText(s.last)) + '</td><td class="fp-meta">' + E(X.changeText(s)) + '</td><td>' + stPill(s.last.status) + '</td></tr>';
      }).join('') + '</table></div>';
    return h + v.docs.map(function (x) {
      var d = x.doc;
      return '<div class="fp-card"><div class="fp-row"><div><h4>' + E(d.title) + '</h4><div class="fp-meta">' + dmy(d.doc_date) + (d.issuer ? ' · ' + E(d.issuer) : '') + ' · ' + E(x.category) + '</div></div>' + (d.has_file ? fileHTML(d.id) : '') + '</div>' +
        (d.notes ? '<div style="font-size:13px;margin-top:4px">' + E(d.notes) + '</div>' : '') +
        (x.results.length ? '<table class="fp-tbl">' + x.results.map(function (r) { return '<tr><td>' + E(r.marker_name) + '</td><td><b>' + dec(r.value) + '</b> ' + E(r.unit || '') + '</td><td>' + E(X.refText(r)) + '</td><td>' + stPill(X.status(r)) + '</td></tr>'; }).join('') + '</table>' : '') + '</div>';
    }).join('');
  }
  function adhHTML(a, label) {
    return '<div style="margin-top:6px"><b style="font-size:13px">' + label + '</b><div class="fp-meta">' + E(N.adherenceText(a, true)) + '</div>' +
      (a.logged ? a.byMeal.map(function (b) { return '<div style="font-size:12.5px;margin-top:4px"><div class="fp-row"><span>' + E(b.name) + '</span><span class="fp-meta">' + (b.pct == null ? 'sin registro' : b.pct + ' % · ' + b.logged + '/' + b.expected) + '</span></div><div class="fp-bar"><i style="width:' + (b.pct || 0) + '%"></i></div></div>'; }).join('') : '') + '</div>';
  }
  function editorHTML() {
    var d = ui.draft;
    return '<div class="fp-card"><h4>Editar plan</h4><div class="fp-meta">Queda a tu nombre y la persona lo ve en su hoja de vida.</div>' + d.meals.map(function (m, k) {
      return '<div class="fp-ed"><label>Comida<input id="fpm_n' + k + '" value="' + E(m.name) + '"></label><label>Hora<input type="time" id="fpm_t' + k + '" value="' + E(m.time) + '"></label>' +
        '<label class="w">Qué comer<input id="fpm_g' + k + '" value="' + E(m.guide) + '"></label><button class="btn" title="Quitar" onclick="SizigiaFicha.removeMeal(' + k + ')">✕</button></div>';
    }).join('') + (d.meals.length < N.MAX_MEALS ? '<div class="pc-acts"><button class="btn" onclick="SizigiaFicha.addMeal()">+ Agregar comida</button></div>' : '') +
      '<label class="fp-meta" style="display:block;margin-top:8px">Indicaciones generales<textarea id="fpm_notes" style="width:100%;min-height:70px;border:1px solid var(--line);border-radius:8px;padding:8px;font-family:inherit">' + E(d.notes) + '</textarea></label>' +
      '<div class="pc-acts"><button class="btn primary"' + (ui.busy ? ' disabled' : '') + ' onclick="SizigiaFicha.savePlan()">' + (ui.busy ? 'Guardando…' : 'Guardar plan') + '</button><button class="btn" onclick="SizigiaFicha.cancelPlan()">Cancelar</button></div>' +
      (ui.msg ? '<div class="fp-err">' + E(ui.msg) + '</div>' : '') + '</div>';
  }
  function nutricionHTML(v) {
    var h = '';
    if (ui.draft) h += editorHTML();
    else {
      var p = v.plan;
      h += '<div class="fp-card"><div class="fp-row"><h4>Plan de alimentación</h4><button class="btn" onclick="SizigiaFicha.editPlan()">' + (p ? 'Editar plan' : 'Crear plan') + '</button></div>';
      if (!p) h += '<div class="fp-meta">Todavía no tiene plan.</div>';
      else {
        h += '<div class="fp-meta">Vigente desde el ' + dmy(p.valid_from) + ' · escrito por ' + (p.author_kind === 'paciente' ? 'la persona' : p.author_kind === 'admin' ? 'el equipo Sizigia' : 'un profesional') + ' · ' + v.versions + (v.versions === 1 ? ' versión' : ' versiones') + '</div>';
        h += '<table class="fp-tbl">' + p.meals.map(function (m) { return '<tr><td style="width:52px" class="fp-meta">' + E(m.time || '—') + '</td><td><b>' + E(m.name) + '</b>' + (m.guide ? '<div class="fp-meta">' + E(m.guide) + '</div>' : '') + '</td></tr>'; }).join('') + '</table>';
        if (p.notes) h += '<div class="fp-meta" style="margin-top:6px;white-space:pre-wrap">' + E(p.notes) + '</div>';
      }
      if (ui.msg) h += '<div class="fp-ok">' + E(ui.msg) + '</div>';
      h += '</div>';
    }
    if (v.plan) h += '<div class="fp-card"><h4>Adherencia</h4>' + adhHTML(v.a7, 'Últimos 7 días') + adhHTML(v.a28, 'Últimos 28 días') +
      '<div class="fp-meta" style="margin-top:6px">Cumplí cuenta 1, parcial ½ y no 0. Lo que no registra no cuenta como incumplido.</div></div>';
    var b = v.body.filter(function (x) { return x.last; });
    h += '<div class="fp-card"><h4>Peso y composición</h4>' + (!b.length ? '<div class="fp-meta">Sin mediciones.</div>' : '<table class="fp-tbl">' + b.map(function (x) {
      return '<tr><td>' + E(x.label) + '</td><td><b>' + dec(x.last.value) + '</b> ' + E(x.unit) + '<div class="fp-meta">' + dmy(x.last.iso) + '</div></td><td class="fp-meta">' +
        (x.dMonth != null ? E(N.signed(x.dMonth, x.unit)) + ' desde el ' + dmy(x.monthIso) : x.dPrev != null ? E(N.signed(x.dPrev, x.unit)) + ' vs. anterior' : 'Primera medición') + '</td></tr>';
    }).join('') + '</table>' + chart(v.body[0].points, { metric: 'weight', days: 90, today: today(), label: 'Peso, últimos 90 días' })) + '</div>';
    return h;
  }

  function sheetHTML() {
    var p = person(ui.open), secs = sections(p.scopes), key = ui.open + ':' + ui.tab, data = ui.data[key];
    var h = '<div class="fp-back" onclick="if(event.target===this)SizigiaFicha.close()"><div class="fp-sheet" role="dialog" aria-modal="true" aria-label="Ficha de ' + E(p.patient_name) + '">' +
      '<div class="fp-top"><div><h2>' + E(p.patient_name) + '</h2><div class="fp-meta">Ves solo lo que te autorizó. Abrir cada sección queda registrado y la persona lo ve.</div></div><button class="btn" onclick="SizigiaFicha.close()">Cerrar</button></div>' +
      '<div class="fp-tabs">' + secs.map(function (s) { return '<button class="fp-tab' + (s.key === ui.tab ? ' on' : '') + '" onclick="SizigiaFicha.setTab(\'' + s.key + '\')">' + E(s.label) + '</button>'; }).join('') + '</div>';
    if (ui.tab === 'equipo') h += root.SizigiaCaso ? root.SizigiaCaso.html() : '';
    else if (ui.err) h += '<div class="fp-card fp-err">' + E(ui.err) + '</div>';
    else if (!data) h += '<div class="fp-card fp-meta">Cargando…</div>';
    else if (ui.tab === 'portada') h += portadaHTML(p, data);
    else if (ui.tab === 'lesiones') h += lesionesHTML(lesionesView(data, today()));
    else if (ui.tab === 'examenes') h += examenesHTML(examenesView(data));
    else h += nutricionHTML(nutricionView(data, today()));
    h += '<div class="fp-meta" style="margin-top:8px">Datos que registra la persona o su equipo. Informativo: no reemplaza tu evaluación.</div>';
    return h + '</div></div>';
  }

  function render() {
    ensureCss();
    if (ui.el) ui.el.innerHTML = listHTML();
    var s = document.getElementById('fp_sheet');
    if (!ui.open) { if (s) s.remove(); document.body.style.overflow = ''; return; }
    if (!s) { s = document.createElement('div'); s.id = 'fp_sheet'; document.body.appendChild(s); }
    var top = s.firstChild && s.firstChild.firstChild ? s.firstChild.firstChild.scrollTop : 0;
    s.innerHTML = sheetHTML(); document.body.style.overflow = 'hidden';
    if (s.firstChild && s.firstChild.firstChild) s.firstChild.firstChild.scrollTop = top;
  }

  // Portada: resumen arriba (semáforo del panel, lesiones abiertas, exámenes fuera de rango) y la línea de tiempo con filtros.
  var SEM = { rojo: ['#A13D2D', 'Rojo'], amarillo: ['#B8862B', 'Amarillo'], verde: ['#55704F', 'Verde'], gris: ['#8a8578', 'Sin datos'] };
  function portadaHTML(p, data) {
    var has = function (s) { return (p.scopes || []).indexOf(s) >= 0; };
    var row = root.SizigiaCoach && root.SizigiaCoach.rowFor ? root.SizigiaCoach.rowFor(ui.open) : null;
    var v = portadaView({ timeline: data, lesiones: has('lesiones') ? ui.data[ui.open + ':lesiones'] || null : null, examenes: has('examenes') ? ui.data[ui.open + ':examenes'] || null : null, row: row }, today());
    var h = '<div class="fp-grid">';
    if (v.sem) {
      var c = SEM[v.sem.level] || SEM.gris;
      h += '<div class="fp-card"><h4>Semáforo</h4><div style="display:flex;align-items:center;gap:8px;font-weight:700"><span style="width:12px;height:12px;border-radius:50%;background:' + c[0] + '"></span>' + c[1] + '</div>' +
        (v.sem.reasons.length ? '<div class="fp-meta" style="margin-top:4px">' + v.sem.reasons.map(E).join('<br>') + '</div>' : '') +
        (v.sem.adherence ? '<div class="fp-meta" style="margin-top:4px">Constancia: ' + E(v.sem.adherence) + (v.sem.weekly ? ' semanas' : ' días') + '</div>' : '') + '</div>';
    }
    if (has('lesiones')) h += '<div class="fp-card"><h4>Lesiones abiertas</h4>' + (!v.injuries ? '<div class="fp-meta">Cargando…</div>' : !v.injuries.length ? '<div class="fp-meta">Ninguna.</div>' :
      v.injuries.map(function (i) { return '<div style="margin-top:4px"><b>' + E(i.name) + '</b> <span class="fp-pill">' + E(i.status) + '</span><div class="fp-meta">' + E(i.text) + '</div></div>'; }).join('')) + '</div>';
    if (has('examenes')) h += '<div class="fp-card"><h4>Exámenes</h4>' + (!v.exams ? '<div class="fp-meta">Cargando…</div>' :
      (v.exams.outOfRange.length ? '<div><b>Fuera de rango:</b> ' + E(v.exams.outOfRange.join(', ')) + '</div>' : '<div class="fp-meta">Sin valores fuera de rango en el último resultado.</div>') +
      (v.exams.last ? '<div class="fp-meta" style="margin-top:4px">Último: ' + E(v.exams.last.title) + ' (' + dmy(v.exams.last.date) + ')</div>' : '')) + '</div>';
    h += '</div><h3 class="fp-h3">Línea de tiempo</h3>';
    h += LT.html(v.items, { E: E, viewer: 'pro', filters: ui.lt, onTopic: 'SizigiaFicha.ltTopic', onAuthor: 'SizigiaFicha.ltAuthor', limit: 60 });
    h += '<div class="fp-meta" style="margin-top:8px">Muestra solo los temas que te autorizó (' + E(v.scopes.map(function (s) { return LT.TOPICS[s] || s; }).join(', ')) + '). Abrir la portada queda registrado en cada uno.</div>';
    return h;
  }
  // Pide una sección y la guarda en ui.data (la misma que usan las pestañas: no se pide dos veces).
  async function fetchSection(k) {
    var key = ui.open + ':' + k;
    if (ui.data[key]) return null;
    if (ui.demo) { ui.data[key] = demoData(k, today(), ui.open); return null; }
    var r = await ui.sb.rpc(BY_KEY[k].rpc, { p_patient: ui.open });
    if (r.error) return /sin permiso/.test(r.error.message) ? 'La persona retiró este permiso.' : 'No se pudo cargar. Reintenta.';
    ui.data[key] = r.data || {};
    return null;
  }
  async function load() {
    var key = ui.open + ':' + ui.tab;
    if (ui.tab === 'equipo') return root.SizigiaCaso.open({ mode: 'pro', sb: ui.sb, demo: ui.demo, patientId: ui.open, patientName: person(ui.open).patient_name, onChange: render });
    if (ui.tab === 'portada') {
      LT.ensureCss(); ui.err = ''; render();
      var sc = person(ui.open).scopes || [], extra = ['lesiones', 'examenes'].filter(function (s) { return sc.indexOf(s) >= 0; });
      var errs = await Promise.all(['portada'].concat(extra).map(fetchSection));
      if (errs[0]) ui.err = errs[0];
      return render();
    }
    if (ui.data[key]) return render();
    ui.err = ''; render();
    if (ui.demo) { ui.data[key] = demoData(ui.tab, today(), ui.open); return render(); }
    var r = await ui.sb.rpc(BY_KEY[ui.tab].rpc, { p_patient: ui.open });
    if (r.error) ui.err = /sin permiso/.test(r.error.message) ? 'La persona retiró este permiso.' : 'No se pudo cargar. Reintenta.';
    else ui.data[key] = r.data || {};
    render();
  }
  // tab opcional ('equipo' desde la bandeja de mensajes).
  function open(id, tab) {
    var p = person(id), secs = p ? sections(p.scopes) : [];
    if (!secs.length) return;
    ui.open = id; ui.tab = secs.some(function (s) { return s.key === tab; }) ? tab : secs[0].key; ui.draft = null; ui.msg = ''; ui.lt = { topic: 'todos', author: 'todos' }; load();
  }
  function syncDraft() {
    var d = ui.draft; if (!d || !document.getElementById('fpm_notes')) return;
    d.notes = document.getElementById('fpm_notes').value;
    d.meals.forEach(function (m, k) { m.name = document.getElementById('fpm_n' + k).value; m.time = document.getElementById('fpm_t' + k).value; m.guide = document.getElementById('fpm_g' + k).value; });
  }
  async function savePlan() {
    if (ui.busy) return;
    syncDraft();
    var meals = N.cleanMeals(ui.draft.meals), notes = String(ui.draft.notes || '').trim(), err = N.validatePlan(meals);
    if (err) { ui.msg = err; return render(); }
    ui.busy = true; ui.msg = ''; render();
    var key = ui.open + ':nutricion';
    if (ui.demo) {
      ui.data[key].plans.unshift({ id: 'np' + Date.now(), valid_from: today(), created_at: new Date().toISOString(), author_kind: 'profesional', notes: notes || null, meals: meals });
    } else {
      var r = await ui.sb.rpc('set_nutrition_plan', { p_patient: ui.open, p_meals: meals, p_notes: notes });
      if (r.error) { ui.busy = false; ui.msg = /sin permiso/.test(r.error.message) ? 'La persona retiró el permiso de nutrición.' : 'No se pudo guardar. Reintenta.'; return render(); }
      var d = await ui.sb.rpc('patient_nutricion', { p_patient: ui.open });
      if (!d.error) ui.data[key] = d.data || {};
    }
    ui.busy = false; ui.draft = null; ui.msg = 'Plan guardado. La persona lo ve en su app y en su hoja de vida.'; render();
  }

  // opts: { el (contenedor de "Otras personas"), sb, demo, linked (my_linked_patients), panelIds (ids del panel del semáforo) }
  function mount(opts) {
    ui.el = opts.el; ui.sb = opts.sb || null; ui.demo = !!opts.demo; ui.linked = opts.linked || []; ui.panelIds = opts.panelIds || [];
    render();
  }

  root.SizigiaFicha = Object.assign({}, core, {
    mount: mount, button: button, open: open, openDoc: openDoc,
    close: function () {
      ui.open = null; ui.draft = null; ui.msg = ''; ui.err = ''; render();
      if (root.SizigiaCaso) { root.SizigiaCaso.close(); root.SizigiaCaso.refreshInbox(); }
    },
    setTab: function (k) { ui.tab = k; ui.draft = null; ui.msg = ''; load(); },
    ltTopic: function (k) { ui.lt.topic = k; render(); },
    ltAuthor: function (k) { ui.lt.author = k; render(); },
    editPlan: function () {
      var v = nutricionView(ui.data[ui.open + ':nutricion'], today()), p = v.plan;
      ui.draft = { meals: (p ? p.meals : N.TEMPLATE).map(function (m) { return Object.assign({ time: '', guide: '' }, m); }), notes: p && p.notes || '' }; ui.msg = ''; render();
    },
    cancelPlan: function () { ui.draft = null; ui.msg = ''; render(); },
    addMeal: function () { syncDraft(); ui.draft.meals.push({ key: N.nextKey(ui.draft.meals), name: '', time: '', guide: '' }); render(); },
    removeMeal: function (k) { syncDraft(); ui.draft.meals.splice(k, 1); render(); },
    savePlan: savePlan
  });
})(typeof window !== 'undefined' ? window : globalThis);
