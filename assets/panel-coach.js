// Panel del coach (equipo.html): 30-80 personas con semáforo, constancia, pendientes, filtros, mensajes por WhatsApp
// con plantilla y configuración del registro de cada persona (set_log_settings con p_patient).
// Datos: coach_feed_v2() (una fila por persona con vínculo activo y permiso 'semaforo'). "Ya le escribí" se guarda con
// mark_contacted() en coach_contacts (supabase/migrations/20261025_panel_coach.sql) y limpia los pendientes de esa persona.
// Usa semaforo.js (computeSemaforo, computeSemaforoComun, semChecksHTML, SEM_LABEL, SEM_LABEL_COMUN) y el núcleo de
// registro-comun.js (SizigiaRegistro). Núcleo puro exportado para Node (tests/panel-coach.test.mjs).
(function (root) {
  'use strict';
  var node = typeof module !== 'undefined' && module.exports;
  var S = node ? require('./semaforo.js') : root;
  var R = node ? require('./registro-comun.js') : root.SizigiaRegistro;

  var ORDER = { rojo: 0, amarillo: 1, gris: 2, verde: 3 };
  var LEVELS = { rojo: 'Rojo', amarillo: 'Amarillo', gris: 'Sin datos', verde: 'Verde' };
  // Mantener las claves en sincronía con el check de coach_contacts.template y mark_contacted (SQL).
  var TEMPLATES = [
    { key: 'recordatorio', label: 'Recordar el registro' },
    { key: 'alerta', label: 'Preguntar por la alerta' },
    { key: 'constancia', label: 'Comentar su constancia' },
    { key: 'habitos', label: 'Recordar sus hábitos' },
    { key: 'otro', label: 'Mensaje libre' }
  ];
  var LOW_ADHERENCE = 0.5;   // menos de la mitad de los registros esperados = pendiente
  var GRAY_RECONTACT_DAYS = 3; // si ya le escribiste por no registrar, no vuelve a pendiente hasta pasados 3 días

  // ---------- Núcleo puro ----------
  function localISO(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function dm(iso) { return iso ? iso.slice(8, 10) + '-' + iso.slice(5, 7) : ''; }
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || ''; }
  function contactDate(c) { return c && c.at ? localISO(new Date(c.at)) : null; }

  // Constancia: deportivo y general diario, últimos 7 días; general semanal, últimas 4 semanas.
  function adherenceFor(p, today) {
    if (p.mode === 'comun') return R.adherence(p.wellness || [], p.frequency, today);
    var set = {}, done = 0;
    (p.athlete || []).forEach(function (l) { set[l.log_date] = true; });
    for (var i = 0; i < 7; i++) if (set[addDays(today, -i)]) done++;
    return { done: done, expected: 7, text: 'Últimos 7 días: ' + done + '/7 registros' };
  }
  // Motivo corto de la alerta, para la fila y para el mensaje: "dolor 7/10", "sueño de anoche 5,2 h".
  function alertText(sem) {
    var c = (sem.checks || []).filter(function (x) { return x.status === 'alert'; })[0] || (sem.checks || []).filter(function (x) { return x.status === 'warn'; })[0];
    if (c) return c.label.toLowerCase() + ' ' + c.detail.replace(/\s*\([^)]*\)\s*$/, '');
    var r = (sem.reasons || [])[0];
    return r ? r.text.replace(/\.$/, '') : '';
  }

  // Una fila del panel a partir de una fila de coach_feed_v2().
  function buildRow(p, today) {
    var comun = p.mode === 'comun', freq = comun ? (p.frequency === 'semanal' ? 'semanal' : 'diaria') : 'diaria';
    var habits = Array.isArray(p.habits) ? p.habits : [];
    var sem = comun ? S.computeSemaforoComun(p.wellness || [], freq) : S.computeSemaforo(p.athlete || []);
    var ad = adherenceFor({ mode: p.mode, frequency: freq, athlete: p.athlete, wellness: p.wellness }, today);
    var last = sem.last ? sem.last.log_date : null, cd = contactDate(p.last_contact), pending = [];
    if ((sem.level === 'rojo' || sem.level === 'amarillo') && !(cd && last && cd >= last))
      pending.push({ key: 'alerta', template: 'alerta', text: (sem.level === 'rojo' ? 'Alerta roja: ' : 'Alerta: ') + alertText(sem) });
    if (sem.level === 'gris' && !(cd && daysBetween(cd, today) < GRAY_RECONTACT_DAYS))
      pending.push({ key: 'sin_registro', template: 'recordatorio', text: last ? 'Sin registro desde el ' + dm(last) : (p.athlete || []).length || (p.wellness || []).length ? 'Sin registro ' + (freq === 'semanal' ? 'semanal' : 'diario') + ' todavía' : 'Nunca ha registrado' });
    if (sem.level !== 'gris' && ad.done / ad.expected < LOW_ADHERENCE && !(cd && daysBetween(cd, today) < 7))
      pending.push({ key: 'constancia', template: 'constancia', text: 'Constancia baja: ' + ad.done + '/' + ad.expected });
    if (comun && !habits.length) pending.push({ key: 'sin_habitos', template: 'habitos', text: 'Sin hábitos definidos' });
    return {
      id: p.patient_id, name: p.patient_name || '', mode: comun ? 'comun' : 'deportivo', frequency: freq, habits: habits,
      sem: sem, level: sem.level, adherence: ad, last: last, contact: p.last_contact || null, contactDate: cd, pending: pending,
      habitStats: comun ? R.habitStats(p.wellness || [], habits, freq, today).filter(function (x) { return x.pct != null; }) : [],
      raw: p
    };
  }
  // Primero lo que pide atención: rojo, amarillo, sin datos, verde; dentro de cada color, con pendientes primero.
  function sortRows(rows) {
    return rows.slice().sort(function (a, b) {
      return ORDER[a.level] - ORDER[b.level] || (b.pending.length > 0) - (a.pending.length > 0) || a.name.localeCompare(b.name, 'es');
    });
  }
  function buildRows(feed, today) { return sortRows((feed || []).map(function (p) { return buildRow(p, today); })); }

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // f: { level: 'todos'|color, mode: 'todos'|'deportivo'|'comun', pending: bool, q: texto }
  function filterRows(rows, f) {
    f = f || {};
    var q = norm(f.q).trim();
    return rows.filter(function (r) {
      return (!f.level || f.level === 'todos' || r.level === f.level) && (!f.mode || f.mode === 'todos' || r.mode === f.mode) &&
        (!f.pending || r.pending.length > 0) && (!q || norm(r.name).indexOf(q) >= 0);
    });
  }
  function summary(rows) {
    var out = { total: rows.length, rojo: 0, amarillo: 0, gris: 0, verde: 0, pending: 0, adherencePct: null }, done = 0, exp = 0;
    rows.forEach(function (r) { out[r.level]++; if (r.pending.length) out.pending++; done += r.adherence.done; exp += r.adherence.expected; });
    if (exp) out.adherencePct = Math.round(done / exp * 100);
    return out;
  }

  // Texto del mensaje. opts.link: URL de la app de la persona. Sin juicio clínico: la alerta se pregunta, no se diagnostica.
  function message(key, row, opts) {
    opts = opts || {};
    var n = firstName(row.name), link = opts.link ? ' ' + opts.link : '', weekly = row.frequency === 'semanal', ad = row.adherence;
    var hola = 'Hola' + (n ? ' ' + n : '') + ', ';
    if (key === 'recordatorio') return hola + '¿cómo vas? Te recuerdo cargar tu registro ' + (weekly ? 'de esta semana' : 'de hoy') + ' en Sizigia Lab: toma menos de un minuto.' + link;
    if (key === 'alerta') {
      var why = alertText(row.sem);
      return hola + 'vi en tu registro' + (row.last ? ' del ' + dm(row.last) : '') + (why ? ': ' + why : '') + '. ¿Cómo te sientes? Si quieres lo conversamos antes de la próxima sesión.';
    }
    if (key === 'constancia') {
      var span = weekly ? 'en las últimas 4 semanas' : 'en los últimos 7 días', good = ad.done / ad.expected >= 0.7;
      if (good) return hola + '¡buena constancia! Llevas ' + ad.done + ' de ' + ad.expected + ' registros ' + span + '. Sigue así.';
      return hola + 'llevas ' + ad.done + ' de ' + ad.expected + ' registros ' + span + '. ' +
        (row.mode === 'comun' && !weekly ? '¿Te acomodaría más registrar una vez por semana? Lo ajusto yo.' : '¿Qué te lo hace difícil? Lo podemos simplificar.') + link;
    }
    if (key === 'habitos') {
      if (!row.habits.length) return hola + '¿definimos juntos 2 o 3 hábitos para las próximas semanas? Después los marcas en tu registro de Sizigia Lab.';
      return hola + 'tus hábitos para estas semanas: ' + row.habits.join(', ') + '. Márcalos en tu registro de Sizigia Lab.' + link;
    }
    return hola;
  }
  // wa.me sin número: WhatsApp abre el selector de contacto. El teléfono de la persona no pasa por el panel.
  function waLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }

  // Semilla de la demo (equipo.html?demo=1): 14 personas con estados variados.
  function demoFeed(todayIso) {
    var seed = 11, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var d = function (k) { return addDays(todayIso, -k); };
    var ath = function (days, over) {
      var out = [];
      for (var k = days.from; k <= days.to; k++) if (!days.skip || rnd() > days.skip)
        out.push(Object.assign({ log_date: d(k), sleep_hours: Math.round((7 + rnd()) * 10) / 10, sleep_quality: 7, fatigue: 3 + Math.round(rnd() * 2), mood: 7, pain_level: 1, pain_zone: null, trained: rnd() > 0.3, session_rpe: 6, session_minutes: 60 }, k === days.from ? over || {} : {}));
      return out;
    };
    var well = function (freq, days, over) {
      var out = [], weekly = freq === 'semanal';
      for (var k = days.from; k <= days.to; k++) {
        if (weekly && k % 7) continue;
        if (days.skip && rnd() < days.skip) continue;
        var date = weekly ? R.mondayOf(d(k)) : d(k), h = {};
        (days.habits || []).forEach(function (x) { h[x] = weekly ? 2 + Math.round(rnd() * 5) : (rnd() > 0.35 ? 1 : 0); });
        out.push(Object.assign({ period: weekly ? 'semana' : 'dia', log_date: date, energy: 6 + Math.round(rnd() * 2), sleep_hours: Math.round((6.8 + rnd()) * 10) / 10, sleep_quality: 7, stress: 4 + Math.round(rnd() * 2), habits: h }, k === days.from ? over || {} : {}));
      }
      return out;
    };
    var hab = ['Caminar 30 minutos', 'Verduras en almuerzo y cena', 'Tomar 2 litros de agua'];
    var ago = function (k) { var x = new Date(Date.parse(d(k) + 'T12:00:00')); return x.toISOString(); };
    var p = function (i, name, o) { return Object.assign({ patient_id: 'demo-' + i, patient_name: name, mode: 'deportivo', frequency: 'diaria', habits: [], athlete: [], wellness: [], last_contact: null }, o); };
    return [
      p(1, 'Matías Lacroix', { athlete: ath({ from: 0, to: 29 }, { pain_level: 7, pain_zone: 'Rodilla derecha' }) }),
      p(2, 'Valentina Rojas', { athlete: ath({ from: 0, to: 29 }, { sleep_hours: 5.2 }) }),
      p(3, 'Joaquín Fuentes', { athlete: ath({ from: 1, to: 29 }, { fatigue: 8 }), last_contact: { at: ago(0), template: 'alerta' } }),
      p(4, 'Camila Herrera', { athlete: ath({ from: 0, to: 29 }) }),
      p(5, 'Benjamín Soto', { athlete: ath({ from: 5, to: 29 }) }),
      p(6, 'Antonia Muñoz', { athlete: ath({ from: 0, to: 20, skip: 0.6 }) }),
      p(7, 'Sofía Contreras', { mode: 'comun', habits: hab, wellness: well('diaria', { from: 0, to: 40, habits: hab }, { energy: 3 }) }),
      p(8, 'Diego Pizarro', { mode: 'comun', habits: hab, wellness: well('diaria', { from: 0, to: 40, habits: hab }) }),
      p(9, 'Isidora Vergara', { mode: 'comun', frequency: 'semanal', habits: hab.slice(0, 2), wellness: well('semanal', { from: 0, to: 42, habits: hab.slice(0, 2) }) }),
      p(10, 'Tomás Araya', { mode: 'comun', frequency: 'semanal', habits: hab, wellness: well('semanal', { from: 21, to: 56, habits: hab }) }),
      p(11, 'Florencia Castro', { mode: 'comun', habits: [], wellness: well('diaria', { from: 0, to: 20 }) }),
      p(12, 'Agustín Morales', { mode: 'comun', habits: hab, wellness: well('diaria', { from: 1, to: 30, skip: 0.55, habits: hab }) }),
      p(13, 'Martina Silva', { mode: 'comun', frequency: 'semanal', habits: hab, wellness: [] }),
      p(14, 'Lucas Espinoza', { athlete: ath({ from: 0, to: 29 }, { mood: 3 }) })
    ];
  }

  var core = { TEMPLATES: TEMPLATES, LOW_ADHERENCE: LOW_ADHERENCE, GRAY_RECONTACT_DAYS: GRAY_RECONTACT_DAYS, localISO: localISO,
    adherenceFor: adherenceFor, alertText: alertText, buildRow: buildRow, buildRows: buildRows, sortRows: sortRows, filterRows: filterRows,
    summary: summary, message: message, waLink: waLink, firstName: firstName, demoFeed: demoFeed };
  if (node) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { el: null, sb: null, demo: false, email: '', link: '', rows: [], f: { level: 'todos', mode: 'todos', pending: false, q: '' },
    open: null, tpl: {}, cfg: null, cfgMsg: '', busy: false, flash: '' };
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var css = '.pc-sum{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.pc-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}' +
    '.pc-chip.on{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}.pc-chip b{font-size:14px}.pc-chip .dot{margin:0}' +
    '.pc-fil{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}.pc-fil input[type=search]{flex:1 1 200px;margin:0;width:auto}.pc-fil select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px;background:#fff}' +
    '.pc-fil label{font-size:13px;display:flex;gap:6px;align-items:center}.pc-fil label input{width:auto;margin:0}' +
    '.pc-list{background:var(--paper);border:1px solid var(--line);border-radius:12px;overflow:hidden}.pc-row{border-top:1px solid var(--line)}.pc-row:first-child{border-top:0}' +
    '.pc-head{display:flex;gap:10px;align-items:center;padding:11px 14px;cursor:pointer;width:100%;background:none;border:0;text-align:left;font-family:inherit;font-size:14px;color:inherit}.pc-head:hover{background:#f6f5f3}' +
    '.pc-name{font-weight:600}.pc-meta{font-size:12px;color:var(--muted)}.pc-main{flex:1;min-width:0}.pc-badges{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}' +
    '.pc-badge{font-size:11.5px;border-radius:6px;padding:2px 7px;background:#fef3c7;color:#92400e}.pc-badge.rojo{background:#fee2e2;color:#991b1b}.pc-badge.ok{background:#ecfdf5;color:#065f46}' +
    '.pc-head .dot{width:12px;height:12px;margin:0;flex:none}.pc-chev{color:var(--muted);font-size:12px;flex:none}.pc-body{padding:4px 14px 16px 34px;display:grid;gap:14px}.pc-sec h4{margin:0 0 6px;font-size:13px}' +
    '.pc-sec textarea{width:100%;min-height:84px;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-family:inherit;font-size:13px}.pc-sec select{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px;background:#fff}' +
    '.pc-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}.pc-acts a.btn{text-decoration:none;color:#fff}.pc-small{font-size:12.5px;color:var(--muted);line-height:1.5}.pc-err{font-size:12.5px;color:#b91c1c;margin-top:6px}.pc-ok{font-size:12.5px;color:#065f46;margin-top:6px}' +
    '.pc-opt{display:flex;gap:8px;align-items:flex-start;padding:5px 0;font-size:13px}.pc-opt input{width:auto;margin:3px 0 0}.pc-opt small{display:block;color:var(--muted);font-size:11.5px}' +
    '.pc-bar{display:inline-block;height:6px;border-radius:3px;background:var(--accent);vertical-align:middle;margin-right:6px}.pc-empty{padding:18px 14px;color:var(--muted)}' +
    '@media (max-width:560px){.pc-body{padding-left:14px}.pc-head{padding:10px 12px}}';

  function labelFor(r) { return r.mode === 'comun' ? SEM_LABEL_COMUN[r.level] : SEM_LABEL[r.level]; }
  function modeText(r) { return r.mode === 'comun' ? 'General ' + (r.frequency === 'semanal' ? 'semanal' : 'diario') : 'Deportivo'; }
  function row(id) { return ui.rows.filter(function (r) { return r.id === id; })[0]; }
  function today() { return localISO(new Date()); }

  function topHTML() {
    var s = summary(ui.rows), f = ui.f;
    var chip = function (lv, n, label) { return '<button class="pc-chip' + (f.level === lv ? ' on' : '') + '" onclick="SizigiaCoach.setLevel(\'' + lv + '\')">' + (lv !== 'todos' ? '<span class="dot ' + lv + '"></span>' : '') + '<b>' + n + '</b> ' + label + '</button>'; };
    var h = '<div class="top"><div><h1>Tus personas</h1><div class="tag">' + E(ui.email) + (ui.demo ? ' · demo sin datos reales' : '') + '</div></div>' +
      (ui.demo ? '' : '<button class="btn" onclick="SizigiaCoach.signOut()">Salir</button>') + '</div>';
    h += '<div class="pc-sum">' + chip('todos', s.total, 'personas') + chip('rojo', s.rojo, 'rojo') + chip('amarillo', s.amarillo, 'amarillo') + chip('gris', s.gris, 'sin datos') + chip('verde', s.verde, 'verde') +
      '<button class="pc-chip' + (f.pending ? ' on' : '') + '" onclick="SizigiaCoach.togglePending()"><b>' + s.pending + '</b> con pendientes</button>' +
      (s.adherencePct != null ? '<span class="pc-chip" style="cursor:default">Constancia del grupo: <b>' + s.adherencePct + ' %</b></span>' : '') + '</div>';
    h += '<div class="pc-fil"><input type="search" id="pc_q" placeholder="Buscar por nombre" value="' + E(f.q) + '" oninput="SizigiaCoach.setQ(this.value)">' +
      '<select onchange="SizigiaCoach.setMode(this.value)">' + [['todos', 'Todos los registros'], ['deportivo', 'Deportivo'], ['comun', 'General']].map(function (o) { return '<option value="' + o[0] + '"' + (f.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    return h;
  }

  function headHTML(r) {
    var badges = r.pending.map(function (p) { return '<span class="pc-badge' + (p.key === 'alerta' && r.level === 'rojo' ? ' rojo' : '') + '">' + E(p.text) + '</span>'; }).join('');
    if (!r.pending.length && r.contactDate) badges = '<span class="pc-badge ok">Contactado el ' + E(r.contactDate.slice(8, 10) + '-' + r.contactDate.slice(5, 7)) + '</span>';
    return '<button class="pc-head" aria-expanded="' + (ui.open === r.id) + '" onclick="SizigiaCoach.toggle(\'' + E(r.id) + '\')"><span class="dot ' + r.level + '"></span><span class="pc-main"><span class="pc-name">' + E(r.name) + '</span>' +
      '<div class="pc-meta">' + E(modeText(r)) + ' · ' + r.adherence.done + '/' + r.adherence.expected + (r.frequency === 'semanal' ? ' semanas' : ' días') + (r.last ? ' · último ' + E(r.last.slice(8, 10) + '-' + r.last.slice(5, 7)) : ' · sin registros') + '</div>' +
      (badges ? '<div class="pc-badges">' + badges + '</div>' : '') + '</span><span class="pc-chev">' + (ui.open === r.id ? '▲' : '▼') + '</span></button>';
  }

  function msgHTML(r) {
    var key = ui.tpl[r.id] || (r.pending[0] ? r.pending[0].template : r.level === 'verde' ? 'constancia' : 'recordatorio');
    var text = message(key, r, { link: ui.link });
    var h = '<div class="pc-sec"><h4>Mensaje por WhatsApp</h4><select onchange="SizigiaCoach.setTpl(\'' + E(r.id) + '\',this.value)">' +
      TEMPLATES.map(function (t) { return '<option value="' + t.key + '"' + (t.key === key ? ' selected' : '') + '>' + E(t.label) + '</option>'; }).join('') + '</select>' +
      '<textarea id="pc_msg_' + E(r.id) + '" style="margin-top:6px">' + E(text) + '</textarea>' +
      '<div class="pc-acts"><a class="btn primary" target="_blank" rel="noopener" href="' + E(waLink(text)) + '" onclick="return SizigiaCoach.send(\'' + E(r.id) + '\',\'' + key + '\',this)">Abrir en WhatsApp</a>' +
      '<button class="btn" onclick="SizigiaCoach.markContacted(\'' + E(r.id) + '\',\'' + key + '\')">Ya le escribí</button></div>' +
      '<div class="pc-small" style="margin-top:6px">WhatsApp se abre con el texto y tú eliges el contacto. Al abrirlo queda marcado como contactado y sus pendientes se limpian.' +
      (r.contactDate ? ' Último contacto: ' + E(r.contactDate.slice(8, 10) + '-' + r.contactDate.slice(5, 7)) + '.' : '') + '</div>';
    if (ui.flash && ui.open === r.id) h += '<div class="pc-ok">' + E(ui.flash) + '</div>';
    return h + '</div>';
  }

  function cfgHTML(r) {
    var h = '<div class="pc-sec"><h4>Registro</h4>';
    if (!ui.cfg || ui.cfg.id !== r.id) {
      return h + '<div class="pc-small">' + E(modeText(r)) + (r.mode === 'comun' ? ' · ' + (r.habits.length ? 'hábitos: ' + E(r.habits.join(', ')) : 'sin hábitos definidos') : ' · sueño, fatiga, ánimo, dolor y carga') +
        '</div><div class="pc-acts"><button class="btn" onclick="SizigiaCoach.openCfg(\'' + E(r.id) + '\')">Cambiar registro</button></div></div>';
    }
    var c = ui.cfg;
    h += '<label class="pc-opt"><input type="radio" name="pc_mode" value="deportivo"' + (c.mode === 'deportivo' ? ' checked' : '') + ' onchange="SizigiaCoach.setCfg(\'mode\',this.value)"><span><b>Deportivo, cada día</b><small>Sueño, fatiga, ánimo, dolor y, si entrenó, esfuerzo y minutos.</small></span></label>';
    h += '<label class="pc-opt"><input type="radio" name="pc_mode" value="comun"' + (c.mode === 'comun' ? ' checked' : '') + ' onchange="SizigiaCoach.setCfg(\'mode\',this.value)"><span><b>General</b><small>Energía, sueño, estrés y hábitos. Sin datos de entrenamiento.</small></span></label>';
    if (c.mode === 'comun') {
      h += '<div style="display:flex;gap:14px;margin:4px 0 8px">' + Object.keys(R.FREQS).map(function (k) {
        return '<label class="pc-opt"><input type="radio" name="pc_freq" value="' + k + '"' + (c.frequency === k ? ' checked' : '') + ' onchange="SizigiaCoach.setCfg(\'frequency\',this.value)"> ' + E(R.FREQS[k]) + '</label>';
      }).join('') + '</div>';
      h += '<div class="pc-small">Hábitos, uno por línea (máximo ' + R.MAX_HABITS + ')</div><textarea id="pc_habits">' + E(c.habits.join('\n')) + '</textarea>';
    }
    if (ui.cfgMsg) h += '<div class="pc-err">' + E(ui.cfgMsg) + '</div>';
    h += '<div class="pc-small" style="margin-top:6px">El cambio queda en la hoja de vida de la persona con tu nombre, y ella lo puede cambiar.</div>';
    return h + '<div class="pc-acts"><button class="btn primary"' + (ui.busy ? ' disabled' : '') + ' onclick="SizigiaCoach.saveCfg()">' + (ui.busy ? 'Guardando…' : 'Guardar registro') + '</button><button class="btn" onclick="SizigiaCoach.closeCfg()">Cancelar</button></div></div>';
  }

  function bodyHTML(r) {
    var s = r.sem, h = '<div class="pc-body"><div class="pc-sec"><h4>' + E(labelFor(r)) + '</h4>';
    h += s.reasons.length ? s.reasons.map(function (x) { return '<div class="reason"><span class="dot ' + x.level + '"></span>' + E(x.text) + '</div>'; }).join('') : '<div class="reason" style="color:var(--muted)">Sin alertas en el último registro.</div>';
    h += semChecksHTML(s.checks || [], s.why || '', E) + '<div class="src">Fuente: registro ' + (r.mode === 'comun' ? 'general ' + (r.frequency === 'semanal' ? 'semanal' : 'diario') : 'deportivo') + ' autoinformado. ' + E(r.adherence.text) + '.</div></div>';
    if (r.habitStats.length) h += '<div class="pc-sec"><h4>Hábitos, últimas 4 semanas</h4><div class="pc-small">' + r.habitStats.map(function (x) {
      return '<div><span class="pc-bar" style="width:' + Math.max(4, x.pct * 0.8) + 'px"></span>' + E(x.habit) + ': ' + x.pct + ' %</div>';
    }).join('') + '</div></div>';
    return h + msgHTML(r) + cfgHTML(r) + '</div>';
  }

  function listHTML() {
    var rows = filterRows(ui.rows, ui.f);
    if (!ui.rows.length) return '<div class="pc-list"><div class="pc-empty">Nadie te ha dado acceso todavía. Cuando una persona te invite desde "Mi equipo" con el permiso "Semáforo y registro", aparece acá.</div></div>';
    if (!rows.length) return '<div class="pc-list"><div class="pc-empty">Nadie coincide con el filtro.</div></div>';
    return '<div class="pc-list">' + rows.map(function (r) { return '<div class="pc-row" id="pc_row_' + E(r.id) + '">' + headHTML(r) + (ui.open === r.id ? bodyHTML(r) : '') + '</div>'; }).join('') + '</div>';
  }
  var NOTE = '<details class="note"><summary style="cursor:pointer">Qué ves y qué no</summary><p>Ves solo a las personas que te dieron permiso, y solo su registro: el deportivo (sueño, fatiga, ánimo, dolor y carga) o el general (energía, sueño, estrés y hábitos). Sin notas libres. Cada vez que abres este panel queda registrado y la persona puede verlo y retirar el permiso cuando quiera.</p>' +
    '<p>El semáforo usa reglas simples pendientes de validación médica y datos que la persona carga por su cuenta. Es una señal para conversar, no un diagnóstico ni una predicción.</p></details>';

  function render() {
    if (!document.getElementById('panel-coach-css')) { var st = document.createElement('style'); st.id = 'panel-coach-css'; st.textContent = css; document.head.appendChild(st); }
    ui.el.innerHTML = topHTML() + NOTE + '<div id="pc_list">' + listHTML() + '</div>';
  }
  function renderList() { var l = document.getElementById('pc_list'); if (l) l.innerHTML = listHTML(); else render(); }

  // opts: { el, sb (cliente Supabase o null en demo), email, feed (coach_feed_v2), demo, link }
  function mount(opts) {
    ui.el = opts.el; ui.sb = opts.sb || null; ui.demo = !!opts.demo; ui.email = opts.email || ''; ui.link = opts.link || '';
    ui.rows = buildRows(opts.feed || [], today());
    render();
  }
  function rebuild(id) {
    var r = row(id); if (!r) return;
    var i = ui.rows.indexOf(r); ui.rows[i] = buildRow(r.raw, today());
  }
  async function markContacted(id, tpl) {
    var r = row(id); if (!r) return;
    var at = new Date().toISOString();
    if (ui.sb && !ui.demo) {
      var res = await ui.sb.rpc('mark_contacted', { p_patient: id, p_template: tpl });
      if (res.error) { console.warn('mark_contacted', res.error); ui.flash = 'No se pudo marcar el contacto. Reintenta en un momento.'; return renderList(); }
      if (res.data) at = res.data;
    }
    r.raw.last_contact = { at: at, template: tpl }; rebuild(id);
    ui.flash = 'Marcado como contactado.'; render();
  }
  function send(id, tpl, a) {
    var el = document.getElementById('pc_msg_' + id), text = el ? el.value : '';
    a.href = waLink(text);   // el coach pudo editar el texto
    setTimeout(function () { markContacted(id, tpl); }, 0);
    return true;
  }
  function readHabits() { var el = document.getElementById('pc_habits'); if (el && ui.cfg) ui.cfg.habits = el.value.split('\n'); }
  async function saveCfg() {
    readHabits();
    var c = ui.cfg, err = R.validateSettings(c);
    if (err) { ui.cfgMsg = err; return renderList(); }
    var next = R.normalizeSettings(c), r = row(c.id);
    if (r.mode === next.mode && r.frequency === next.frequency && r.habits.join('\n') === next.habits.join('\n')) { ui.cfg = null; return renderList(); }
    ui.busy = true; ui.cfgMsg = ''; renderList();
    if (ui.sb && !ui.demo) {
      var res = await ui.sb.rpc('set_log_settings', { p_patient: c.id, p_mode: next.mode, p_frequency: next.frequency, p_habits: next.habits });
      if (res.error) { console.warn('set_log_settings', res.error); ui.busy = false; ui.cfgMsg = 'No se pudo guardar. ¿Sigue vigente su permiso? Reintenta en un momento.'; return renderList(); }
    }
    Object.assign(r.raw, { mode: next.mode, frequency: next.frequency, habits: next.habits });
    rebuild(c.id); ui.cfg = null; ui.busy = false; ui.flash = 'Registro actualizado: ' + R.settingsSummary(next).title.replace('Registro: ', '') + '.'; render();
  }

  root.SizigiaCoach = Object.assign({}, core, {
    mount: mount, markContacted: markContacted, send: send, saveCfg: saveCfg,
    toggle: function (id) { ui.open = ui.open === id ? null : id; ui.cfg = null; ui.cfgMsg = ''; ui.flash = ''; renderList(); },
    setLevel: function (lv) { ui.f.level = ui.f.level === lv ? 'todos' : lv; render(); },
    togglePending: function () { ui.f.pending = !ui.f.pending; render(); },
    setMode: function (m) { ui.f.mode = m; renderList(); },
    setQ: function (q) { ui.f.q = q; renderList(); },
    setTpl: function (id, k) { ui.tpl[id] = k; ui.flash = ''; renderList(); },
    openCfg: function (id) { var r = row(id); ui.cfg = { id: id, mode: r.mode, frequency: r.frequency, habits: r.habits.length ? r.habits.slice() : R.SUGGESTED.slice(0, 3) }; ui.cfgMsg = ''; ui.flash = ''; renderList(); },
    setCfg: function (k, v) { readHabits(); ui.cfg[k] = v; renderList(); },
    closeCfg: function () { ui.cfg = null; ui.cfgMsg = ''; renderList(); },
    signOut: function () { ui.sb.auth.signOut().then(function () { location.reload(); }); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
