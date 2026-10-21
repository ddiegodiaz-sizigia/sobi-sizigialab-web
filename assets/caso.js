// Caso: conversación del equipo alrededor de una persona. Los profesionales se escriben entre sí y con la persona,
// por hilos con tema (general, lesiones, exámenes, nutrición, salud mental…), y cada mensaje queda con autor, fecha,
// destinatarios, versiones y quién lo leyó. Un mensaje se puede pasar a la hoja de vida (journal_entries).
// Backend: supabase/migrations/20261029_caso_equipo.sql (post_case_message, case_feed, my_case_feed, my_case_inbox…).
// Reglas de lectura (las aplica el servidor; acá se repiten para explicar en pantalla quién va a leer):
//   un profesional lee si el mensaje va dirigido a él y tiene permiso 'equipo' + el permiso del tema;
//   la persona lee lo dirigido a ella y de lo demás solo ve que existe (fecha, quién, tema).
// Pantallas: profesional en la ficha de equipo.html (pestaña "Caso", vía ficha-profesional.js) y bandeja en el panel
// (hook en panel-coach.js); persona en la pestaña "Mi equipo" de rueda_final.html (hook en mi-equipo.js).
// Adjuntos (migración 20261031_adjuntos.sql): bucket privado 'caso', ruta <persona>/<quien sube>/<aleatorio>.<ext>.
// Se envían con post_case_message_files; se abren con open_case_file (mismas reglas que el mensaje, registra el
// acceso del profesional y habilita el archivo 2 minutos) y una URL firmada de 5 minutos.
// Núcleo puro exportado para Node (tests/caso.test.mjs).
(function (root) {
  'use strict';
  var TOPICS = [
    { key: 'general', label: 'General' },
    { key: 'semaforo', label: 'Semáforo y registro' },
    { key: 'lesiones', label: 'Lesiones' },
    { key: 'examenes', label: 'Exámenes' },
    { key: 'nutricion', label: 'Nutrición' },
    { key: 'salud_mental', label: 'Salud mental', sensitive: true },
    { key: 'ciclo', label: 'Ciclo menstrual', sensitive: true }
  ];
  var TOPIC_BY = {}; TOPICS.forEach(function (t) { TOPIC_BY[t.key] = t; });
  var ROLES = { medico: 'Médico', entrenador: 'Entrenador', preparador: 'Preparador físico', psicologo: 'Psicólogo', nutricionista: 'Nutricionista', kinesiologo: 'Kinesiólogo', familia: 'Familia', otro: 'Otro' };
  var REF_TOPIC = { lesion: 'lesiones', examen: 'examenes' };
  var MAX_BODY = 4000, MAX_TITLE = 120;
  var LINK_EQUIPO = 'https://sizigialab.cl/equipo.html';
  // Igual al bucket 'caso' (allowed_mime_types y file_size_limit) y al máximo de post_case_message_files.
  var FILE_TYPES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
  var MAX_FILES = 5, MAX_FILE_BYTES = 10485760;

  // ---------- Núcleo puro ----------
  // Igual a case_journal_scope() en SQL.
  function journalScope(topic) { return ['lesiones', 'examenes', 'nutricion', 'salud_mental', 'ciclo'].indexOf(topic) >= 0 ? topic : 'bitacora'; }
  function canRead(member, topic) { return !!member && (member.topics || []).indexOf(topic) >= 0; }
  // Profesionales que hoy pueden leer el tema (sin quien escribe).
  function readersFor(team, topic, me) { return (team || []).filter(function (p) { return p.id !== me && canRead(p, topic); }); }
  // Temas que puede elegir quien escribe: el profesional, los que él lee; la persona, los que alguien de su equipo lee.
  function topicsFor(mode, team, me) {
    return TOPICS.filter(function (t) {
      if (mode === 'pro') return canRead((team || []).filter(function (p) { return p.id === me; })[0], t.key);
      return readersFor(team, t.key, null).length > 0;
    });
  }
  // A quién llega: { pros: [ids], patient: bool }. Misma lógica que post_case_message.
  function recipients(d, ctx) {
    var readers = readersFor(ctx.team, d.topic, ctx.me).map(function (p) { return p.id; });
    if (d.audience === 'directo') return { pros: uniq(d.to), patient: ctx.mode === 'persona' || !!d.withPatient, readers: readers };
    return { pros: readers, patient: d.audience === 'equipo_persona', readers: readers };
  }
  function uniq(a) { var s = {}; return (a || []).filter(function (x) { return s[x] ? false : (s[x] = true); }); }
  function nameOf(team, id) { var p = (team || []).filter(function (x) { return x.id === id; })[0]; return p ? p.name : 'alguien que ya no está en el equipo'; }

  // d: { thread (null = hilo nuevo), title, topic, ref, body, audience, to, withPatient, mentions, journal }
  // ctx: { mode: 'pro'|'persona', team, me }. Devuelve el error para mostrar o null.
  function validate(d, ctx) {
    if (!d.thread) {
      var title = String(d.title || '').trim();
      if (!title) return 'Ponle un título al hilo.';
      if (title.length > MAX_TITLE) return 'El título es muy largo (máximo ' + MAX_TITLE + ' caracteres).';
      if (!TOPIC_BY[d.topic]) return 'Elige el tema.';
      if (d.ref && REF_TOPIC[d.ref.kind] !== d.topic) return 'Lo enlazado no corresponde al tema.';
    }
    var body = String(d.body || '').trim();
    if (!body) return 'Escribe el mensaje.';
    if (body.length > MAX_BODY) return 'El mensaje es muy largo (máximo ' + MAX_BODY + ' caracteres).';
    if (['equipo', 'equipo_persona', 'directo'].indexOf(d.audience) < 0 || (ctx.mode === 'persona' && d.audience === 'equipo')) return 'Elige a quién va.';
    var r = recipients(d, ctx);
    if (d.audience === 'directo') {
      var bad = r.pros.filter(function (id) { return r.readers.indexOf(id) < 0; });
      if (bad.length) return nameOf(ctx.team, bad[0]) + ' no tiene permiso para el tema ' + TOPIC_BY[d.topic].label.toLowerCase() + '.';
      if (!r.pros.length && !(ctx.mode === 'pro' && r.patient)) return 'Elige a quién va.';
    }
    if (!r.pros.length && (ctx.mode === 'persona' || !r.patient)) return 'Nadie del equipo puede leer el tema ' + TOPIC_BY[d.topic].label.toLowerCase() + '. Para eso, la persona debe darle ese permiso en "Mi equipo".';
    var off = (d.mentions || []).filter(function (id) { return r.pros.indexOf(id) < 0; });
    if (off.length) return 'Solo puedes mencionar a quien recibe el mensaje.';
    if (d.journal && ['nota', 'consulta'].indexOf(d.journal) < 0) return 'Tipo de registro inválido.';
    return null;
  }

  // files: [{ name, type, size }] (File del navegador). Devuelve el error para mostrar o null.
  function validateFiles(files) {
    var f = files || [];
    if (f.length > MAX_FILES) return 'Máximo ' + MAX_FILES + ' archivos por mensaje.';
    for (var k = 0; k < f.length; k++) {
      if (!FILE_TYPES[f[k].type]) return '"' + f[k].name + '" no es PDF ni imagen (JPG, PNG, WEBP o HEIC).';
      if (f[k].size > MAX_FILE_BYTES) return '"' + f[k].name + '" pesa más de 10 MB.';
      if (!f[k].size) return '"' + f[k].name + '" está vacío.';
    }
    return null;
  }
  // Sin el nombre original en la ruta (puede traer datos de salud); el nombre va en case_attachments.
  function filePath(patientId, uid, type, rand) { return patientId + '/' + uid + '/' + rand + '.' + (FILE_TYPES[type] || 'bin'); }
  function sizeText(b) { b = Number(b) || 0; return b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : String(Math.round(b / 104857.6) / 10).replace('.', ',') + ' MB'; }

  // Feed (case_feed / my_case_feed) → hilos con sus mensajes (última versión de cada uno), ordenados por actividad.
  function buildThreads(feed) {
    var me = feed.me || null, roots = {}, order = [];
    (feed.messages || []).slice().sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }).forEach(function (m) {
      if (!roots[m.root_id]) { roots[m.root_id] = []; order.push(m.root_id); }
      roots[m.root_id].push(m);
    });
    var threads = {}, list = [];
    (feed.threads || []).forEach(function (t) { threads[t.id] = { thread: t, items: [], unread: 0, mentions: 0, hidden: 0, lastAt: t.created_at, people: [] }; list.push(threads[t.id]); });
    order.forEach(function (rid) {
      var v = roots[rid].sort(function (a, b) { return a.version - b.version; }), last = v[v.length - 1], t = threads[last.thread_id];
      if (!t) return;
      t.items.push({ id: last.id, msg: last, firstAt: v[0].created_at, history: v.slice(0, -1), edited: v.length > 1 });
      if (last.unread && !last.retracted && !last.hidden) { t.unread++; if (me && (last.mentions || []).indexOf(me) >= 0) t.mentions++; }
      if (last.hidden) t.hidden++;
      if (last.created_at > t.lastAt) t.lastAt = last.created_at;
      var who = last.author_kind === 'paciente' ? null : last.author_name;
      if (who && t.people.indexOf(who) < 0) t.people.push(who);
    });
    return list.filter(function (t) { return t.items.length; }).map(function (t) {
      t.items.sort(function (a, b) { return a.firstAt < b.firstAt ? -1 : 1; });
      t.onlyHidden = t.hidden === t.items.length;
      return t;
    }).sort(function (a, b) { return a.lastAt < b.lastAt ? 1 : -1; });
  }

  function joinNames(n) { return n.length <= 1 ? n.join('') : n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1]; }
  // Para quién fue. mode 'persona' habla de "ti"; 'pro' habla de "la persona".
  function audienceText(m, mode) {
    var you = mode === 'persona' ? 'ti' : 'la persona';
    var names = (m.to || []).map(function (x) { return x.name; });
    if (m.audience === 'equipo_persona') return m.author_kind === 'paciente' ? 'Para todo el equipo' : 'Para todo el equipo y ' + you;
    if (m.audience === 'equipo') return 'Solo profesionales' + (names.length ? ': ' + joinNames(names) : '');
    if (m.author_kind === 'paciente') return 'Para ' + joinNames(names);
    return 'Para ' + joinNames(names.concat(m.patient_can_read ? [you] : []));
  }
  function readText(m, mode) {
    var you = mode === 'persona' ? 'ti' : 'la persona';
    var n = (m.reads || []).map(function (r) { return r.patient ? you : r.name; }).filter(Boolean);
    return n.length ? 'Leído por ' + joinNames(n) : 'Nadie lo ha leído todavía';
  }
  // Aviso por WhatsApp sin contenido: solo que hay un mensaje y dónde verlo.
  function waNotify(names, patientName, link) {
    var t = 'Hola ' + joinNames(names) + ', te escribí en el caso de ' + patientName + ' en Sizigia Lab. Lo ves en ' + (link || LINK_EQUIPO) + '.';
    return 'https://wa.me/?text=' + encodeURIComponent(t);
  }
  function inboxSort(rows) {
    return (rows || []).filter(function (r) { return Number(r.unread) > 0; }).sort(function (a, b) {
      return (Number(b.mentions) > 0) - (Number(a.mentions) > 0) || (a.last_at < b.last_at ? 1 : -1);
    });
  }

  var DEMO_IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="150"><rect width="360" height="150" fill="#f4f1ea"/>' +
    '<text x="20" y="38" font-family="sans-serif" font-size="18" fill="#2b2b2b">Pauta de excéntricos (ejemplo)</text>' +
    '<text x="20" y="72" font-family="sans-serif" font-size="14" fill="#555">Sentadilla búlgara 3x8, bajada en 4 s</text>' +
    '<text x="20" y="96" font-family="sans-serif" font-size="14" fill="#555">Nórdicos asistidos 3x6</text><text x="20" y="120" font-family="sans-serif" font-size="14" fill="#555">Sin saltos por 2 semanas</text></svg>');
  // Datos de ejemplo (sin red). mode 'pro': lo que ve Tomás Fuentes (entrenador: general, semáforo, lesiones);
  // mode 'persona': lo que ve la persona. Se arma un solo caso y se filtra con las mismas reglas del servidor.
  function demoFeed(mode, nowMs) {
    var h = 3600000, iso = function (hoursAgo) { return new Date(nowMs - hoursAgo * h).toISOString(); };
    var team = [
      { id: 'pro-tf', name: 'Tomás Fuentes', role: 'entrenador', topics: ['general', 'semaforo', 'lesiones'] },
      { id: 'pro-ma', name: 'Dr. Manuel Acuña', role: 'medico', topics: TOPICS.map(function (t) { return t.key; }) },
      { id: 'pro-pr', name: 'Paula Rojas', role: 'kinesiologo', topics: ['general', 'semaforo', 'lesiones'] },
      { id: 'pro-vm', name: 'Valentina Mora', role: 'psicologo', topics: ['general', 'salud_mental'] }
    ];
    var N = {}; team.forEach(function (p) { N[p.id] = p; });
    var threads = [
      { id: 't1', title: 'Rodilla derecha: vuelta a los saltos', topic: 'lesiones', ref_kind: 'lesion', ref_id: 'i1', ref_label: 'Rodilla · Molestia al aterrizar saltos', created_at: iso(30) },
      { id: 't2', title: 'Ferritina y vitamina D', topic: 'examenes', ref_kind: 'examen', ref_id: 'x2', ref_label: 'Perfil bioquímico y hemograma', created_at: iso(120) },
      { id: 't3', title: 'Ansiedad antes de competir', topic: 'salud_mental', ref_kind: null, ref_id: null, created_at: iso(50) },
      { id: 't4', title: 'Semana de carga baja', topic: 'general', ref_kind: null, ref_id: null, created_at: iso(8) }
    ];
    var raw = [
      ['m1', 't1', 'pro-pr', 30, 'equipo_persona', ['pro-tf', 'pro-ma'], true, 'Hoy el dolor subió a 7/10 al aterrizar. Propongo dos semanas sin pliometría y seguir con excéntricos 3 veces por semana.', [], true],
      ['m2', 't1', 'pro-ma', 26, 'equipo', ['pro-tf', 'pro-pr'], false, 'Si el fin de semana sigue sobre 5/10, pido resonancia. Tomás, ¿puedes sacar los saltos de los entrenamientos de esta semana?', ['pro-tf'], false],
      ['m3', 't1', null, 20, 'equipo_persona', ['pro-tf', 'pro-ma', 'pro-pr'], true, 'Ok. También me molesta al bajar escaleras.', [], false],
      ['m4', 't2', 'pro-ma', 120, 'equipo_persona', [], true, 'La ferritina volvió al rango (38). La vitamina D sigue baja: mantener suplemento y repetir en 3 meses.', [], true],
      ['m5', 't3', 'pro-vm', 50, 'directo', ['pro-ma'], false, 'Manuel, conversamos con la persona sobre el sueño antes de competir. Te cuento en el control.', ['pro-ma'], false],
      ['m6', 't4', 'pro-tf', 8, 'equipo_persona', ['pro-ma', 'pro-pr', 'pro-vm'], true, 'Esta semana bajamos la carga al 70 % y sin saltos, como pidió Paula.', [], false]
    ];
    var me = mode === 'pro' ? 'pro-tf' : null;
    var messages = raw.map(function (r) {
      var a = r[2] ? N[r[2]] : null;
      return { id: r[0], thread_id: r[1], root_id: r[0], version: 1, author_kind: a ? 'profesional' : 'paciente', author_id: a ? a.id : null, author_name: a ? a.name : null, author_role: a ? a.role : null,
        body: r[7], retracted: false, audience: r[4], patient_can_read: r[6], in_journal: r[9], created_at: iso(r[3]),
        to: r[5].map(function (id) { return { id: id, name: N[id].name }; }), mentions: r[8],
        reads: r[5].filter(function (id) { return id !== me && !(r[0] === 'm2'); }).map(function (id) { return { professional_id: id, name: N[id].name, patient: false }; }).concat(r[6] && a && r[0] !== 'm6' ? [{ patient: true }] : []),
        unread: mode === 'pro' ? r[0] === 'm2' || r[0] === 'm3' : r[0] === 'm6',
        files: r[0] === 'm1' ? [{ id: 'f1', file_name: 'Pauta de excéntricos.png', mime_type: 'image/png', size_bytes: 184320, local_url: DEMO_IMG }] : [] };
    });
    var topicOf = {}; threads.forEach(function (t) { topicOf[t.id] = t.topic; });
    if (mode === 'pro') {
      messages = messages.filter(function (m) { return canRead(N[me], topicOf[m.thread_id]) && (m.author_id === me || m.to.some(function (x) { return x.id === me; })); });
      var used = {}; messages.forEach(function (m) { used[m.thread_id] = true; });
      return { me: me, team: team, threads: threads.filter(function (t) { return used[t.id]; }), messages: messages,
        refs: { lesion: [{ id: 'i1', label: 'Rodilla · Molestia al aterrizar saltos' }, { id: 'i2', label: 'Tobillo / pie · Esguince grado I' }], examen: [] } };
    }
    messages = messages.map(function (m) {
      if (m.patient_can_read || m.author_kind === 'paciente') return m;
      return { id: m.id, thread_id: m.thread_id, root_id: m.root_id, version: 1, hidden: true, author_kind: m.author_kind, author_id: m.author_id, author_name: m.author_name, author_role: m.author_role, retracted: false, created_at: m.created_at };
    });
    return { me: null, team: team, messages: messages, threads: threads.map(function (t) {
      var vis = messages.some(function (m) { return m.thread_id === t.id && !m.hidden; });
      return Object.assign({}, t, { title: vis ? t.title : null });
    }) };
  }

  var core = { TOPICS: TOPICS, ROLES: ROLES, FILE_TYPES: FILE_TYPES, MAX_FILES: MAX_FILES, MAX_FILE_BYTES: MAX_FILE_BYTES, validateFiles: validateFiles, filePath: filePath, sizeText: sizeText, journalScope: journalScope, canRead: canRead, readersFor: readersFor, topicsFor: topicsFor, recipients: recipients, validate: validate,
    buildThreads: buildThreads, audienceText: audienceText, readText: readText, waNotify: waNotify, inboxSort: inboxSort, demoFeed: demoFeed };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  // Un solo caso abierto por página: el de la ficha (profesional) o el de la persona.
  var ctl = null;
  var inbox = { sb: null, demo: false, rows: null, loading: false, seen: {} };
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var css = '.cs-meta{font-size:14.5px;color:var(--muted);line-height:1.5}.cs-pill{font-size:13px;border-radius:999px;padding:2px 8px;background:#f1f0ee;white-space:nowrap;display:inline-block}' +
    '.cs-pill.new{background:#ccfbf1;color:#115e59}.cs-pill.men{background:#fef3c7;color:#92400e}.cs-pill.hv{background:#e0e7ff;color:#3730a3}' +
    '.cs-th{background:var(--paper,#fff);border:1px solid var(--line);border-radius:12px;margin-bottom:10px;overflow:hidden}' +
    '.cs-th-h{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;padding:11px 14px;cursor:pointer;background:none;border:0;width:100%;text-align:left;font-family:inherit;font-size:16px;color:inherit}' +
    '.cs-th-h b{display:block;font-size:16px}.cs-msgs{border-top:1px solid var(--line);padding:4px 14px 12px}' +
    '.cs-m{padding:10px 0;border-top:1px dashed var(--line)}.cs-m:first-child{border-top:0}.cs-m.mine{background:linear-gradient(90deg,rgba(13,148,136,.06),transparent);margin:0 -14px;padding:10px 14px}' +
    '.cs-m.unread{box-shadow:inset 3px 0 0 var(--accent,#0d9488);padding-left:10px}.cs-m.hid{color:var(--muted);font-size:14.5px;font-style:italic}' +
    '.cs-body{font-size:15.5px;white-space:pre-wrap;margin:4px 0;line-height:1.5}.cs-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.cs-acts .btn{padding:4px 10px;font-size:14px}' +
    '.cs-comp{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:#fff;margin:10px 0}.cs-comp label.f{display:block;font-size:14px;color:var(--muted);margin-top:8px}' +
    '.cs-comp input[type=text],.cs-comp select,.cs-comp textarea{width:100%;border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-family:inherit;font-size:15.5px;margin:3px 0 0;box-sizing:border-box}' +
    '.cs-comp textarea{min-height:90px;resize:vertical}.cs-opt{display:flex;gap:7px;align-items:flex-start;font-size:15px;padding:3px 0}.cs-opt input{margin-top:3px;width:auto}' +
    '.cs-opt small{display:block;color:var(--muted);font-size:13px}.cs-who{margin:4px 0 0 22px}.cs-err{font-size:14.5px;color:#b91c1c;margin-top:6px}.cs-ok{font-size:14.5px;color:#065f46;margin-top:6px}' +
    '.cs-files{margin:4px 0}.cs-file{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14.5px;padding:3px 0}.cs-file .btn{padding:3px 9px;font-size:13.5px}.cs-file img{display:block;max-width:100%;max-height:320px;border:1px solid var(--line);border-radius:8px;margin-top:4px;flex-basis:100%}' +
    '.cs-inbox{background:var(--paper,#fff);border:1px solid var(--line);border-radius:12px;padding:10px 14px;margin-bottom:12px}.cs-inbox-row{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--line)}.cs-inbox-row:first-of-type{border-top:0}';

  function ensureCss() { if (!document.getElementById('caso-css')) { var s = document.createElement('style'); s.id = 'caso-css'; s.textContent = css; document.head.appendChild(s); } }
  function when(ts) { var d = new Date(ts); return String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function role(r) { return ROLES[r] ? ROLES[r].toLowerCase() : ''; }
  function changed() { if (ctl && ctl.onChange) ctl.onChange(); }
  function ctx() { return { mode: ctl.mode, team: ctl.data.team || [], me: ctl.data.me || null }; }
  function errText(e, fallback) {
    var m = e && e.message || '';
    if (/sin permiso equipo/.test(m)) return 'La persona retiró el permiso de conversación del equipo.';
    if (/destinatario sin permiso|nadie del equipo/.test(m)) return 'Alguien perdió el permiso para este tema. Recarga e intenta de nuevo.';
    if (/hoja de vida/.test(m)) return 'Ese mensaje ya está en la hoja de vida: escribe uno nuevo con la corrección.';
    return fallback;
  }

  function newComp(thread) {
    var c = { thread: thread ? thread.thread.id : null, title: '', topic: thread ? thread.thread.topic : '', ref: null, body: '', audience: 'equipo_persona', to: [], withPatient: false, mentions: [], journal: '', files: [], err: '' };
    if (thread) {
      // La respuesta parte con la misma audiencia del último mensaje legible del hilo.
      var last = thread.items.filter(function (i) { return !i.msg.hidden; }).slice(-1)[0];
      if (last) {
        var m = last.msg, me = ctl.data.me;
        c.audience = ctl.mode === 'persona' && m.audience === 'equipo' ? 'equipo_persona' : m.audience;
        if (c.audience === 'directo') {
          c.to = (m.to || []).map(function (x) { return x.id; }).filter(function (id) { return id !== me; });
          if (m.author_kind === 'profesional' && m.author_id !== me) c.to.push(m.author_id);
          c.to = c.to.filter(function (id) { return readersFor(ctl.data.team, c.topic, me).some(function (p) { return p.id === id; }); });
          c.withPatient = m.patient_can_read;
        }
      }
    } else {
      var t = topicsFor(ctl.mode, ctl.data.team, ctl.data.me);
      c.topic = t.length ? t[0].key : 'general';
    }
    return c;
  }

  function compHTML() {
    var c = ctl.comp, x = ctx(), readers = readersFor(x.team, c.topic, x.me), r = recipients(c, x);
    var h = '<div class="cs-comp">' + (c.thread ? '<b style="font-size:15px">Responder</b>' : '<b style="font-size:16px">Nuevo hilo</b>');
    if (!c.thread) {
      h += '<label class="f">Título<input type="text" maxlength="' + MAX_TITLE + '" value="' + E(c.title) + '" oninput="SizigiaCaso.set(\'title\',this.value)" placeholder="Ej.: Rodilla derecha, vuelta a los saltos"></label>';
      h += '<label class="f">Tema<select onchange="SizigiaCaso.setTopic(this.value)">' + topicsFor(x.mode, x.team, x.me).map(function (t) { return '<option value="' + t.key + '"' + (t.key === c.topic ? ' selected' : '') + '>' + E(t.label) + '</option>'; }).join('') + '</select></label>';
      var refKind = c.topic === 'lesiones' ? 'lesion' : c.topic === 'examenes' ? 'examen' : null, refs = refKind && ctl.data.refs ? ctl.data.refs[refKind] || [] : [];
      if (refs.length) h += '<label class="f">Enlazar con (opcional)<select onchange="SizigiaCaso.setRef(\'' + refKind + '\',this.value)"><option value="">Nada</option>' + refs.map(function (o) { return '<option value="' + E(o.id) + '"' + (c.ref && c.ref.id === o.id ? ' selected' : '') + '>' + E(o.label) + '</option>'; }).join('') + '</select></label>';
      h += '<div class="cs-meta" style="margin-top:4px">Solo lo leen quienes tienen permiso para ' + E(TOPIC_BY[c.topic] ? TOPIC_BY[c.topic].label.toLowerCase() : 'este tema') + (readers.length ? ': ' + E(joinNames(readers.map(function (p) { return p.name; }))) : ': nadie más del equipo por ahora') + '.</div>';
    }
    h += '<label class="f">Mensaje<textarea maxlength="' + MAX_BODY + '" oninput="SizigiaCaso.set(\'body\',this.value)" placeholder="' + (x.mode === 'persona' ? 'Escribe a tu equipo…' : 'Escribe al equipo…') + '">' + E(c.body) + '</textarea></label>';
    h += '<label class="f">Adjuntar (opcional): PDF o imagen, hasta ' + MAX_FILES + ' de 10 MB<input type="file" multiple accept="' + Object.keys(FILE_TYPES).join(',') + '" onchange="SizigiaCaso.addFiles(this)"></label>';
    if (c.files.length) h += '<div class="cs-files">' + c.files.map(function (f, k) { return '<div class="cs-file"><span>' + E(f.name) + ' <span class="cs-meta">· ' + sizeText(f.size) + '</span></span><button class="btn small" onclick="SizigiaCaso.removeFile(' + k + ')">Quitar</button></div>'; }).join('') +
      '<div class="cs-meta">Los archivos los ven las mismas personas que el mensaje. Si un profesional abre uno, queda registrado.</div></div>';
    h += '<div class="f cs-meta" style="margin-top:8px">¿Quién lo lee?</div>';
    var opts = x.mode === 'persona'
      ? [['equipo_persona', 'Todo mi equipo', 'Quienes tienen permiso para este tema.'], ['directo', 'Solo a quienes elija', '']]
      : [['equipo_persona', 'El equipo y la persona', 'La persona lo ve en su app.'], ['equipo', 'Solo profesionales', 'La persona ve que hubo un mensaje, pero no su contenido.'], ['directo', 'Solo a quienes elija', '']];
    h += opts.map(function (o) {
      return '<label class="cs-opt"><input type="radio" name="cs_aud" value="' + o[0] + '"' + (c.audience === o[0] ? ' checked' : '') + ' onchange="SizigiaCaso.setAudience(this.value)"><span><b>' + o[1] + '</b>' + (o[2] ? '<small>' + o[2] + '</small>' : '') + '</span></label>';
    }).join('');
    if (c.audience === 'directo') {
      h += '<div class="cs-who">' + (readers.length ? readers.map(function (p) {
        return '<label class="cs-opt"><input type="checkbox"' + (c.to.indexOf(p.id) >= 0 ? ' checked' : '') + ' onchange="SizigiaCaso.toggleTo(\'' + E(p.id) + '\',this.checked)"><span>' + E(p.name) + ' <small style="display:inline">· ' + E(role(p.role)) + '</small></span></label>';
      }).join('') : '<div class="cs-meta">Nadie más del equipo puede leer este tema.</div>');
      if (x.mode === 'pro') h += '<label class="cs-opt"><input type="checkbox"' + (c.withPatient ? ' checked' : '') + ' onchange="SizigiaCaso.set(\'withPatient\',this.checked,true)"><span>También la persona</span></label>';
      h += '</div>';
    }
    if (r.pros.length) h += '<div class="f cs-meta" style="margin-top:8px">Avisar a (mención)</div><div class="cs-who" style="margin-left:0">' + r.pros.map(function (id) {
      return '<label class="cs-opt" style="display:inline-flex;margin-right:12px"><input type="checkbox"' + (c.mentions.indexOf(id) >= 0 ? ' checked' : '') + ' onchange="SizigiaCaso.toggleMention(\'' + E(id) + '\',this.checked)"><span>' + E(nameOf(x.team, id)) + '</span></label>';
    }).join('') + '</div>';
    h += '<label class="f">Hoja de vida<select onchange="SizigiaCaso.set(\'journal\',this.value)"><option value="">No pasar a la hoja de vida</option><option value="nota"' + (c.journal === 'nota' ? ' selected' : '') + '>Pasar como nota</option>' +
      (x.mode === 'pro' ? '<option value="consulta"' + (c.journal === 'consulta' ? ' selected' : '') + '>Pasar como consulta (resumen o transcripción)</option>' : '') + '</select></label>';
    if (c.journal) h += '<div class="cs-meta">Queda en la hoja de vida a tu nombre y la persona siempre lo ve ahí' + (c.audience === 'equipo' || (c.audience === 'directo' && !r.patient) ? ', aunque este mensaje sea solo para profesionales' : '') + '. Después no se puede editar ni retirar.</div>';
    h += '<div class="cs-acts" style="margin-top:10px"><button class="btn primary small"' + (ctl.busy ? ' disabled' : '') + ' onclick="SizigiaCaso.send()">' + (ctl.busy ? 'Enviando…' : 'Enviar') + '</button><button class="btn small" onclick="SizigiaCaso.cancel()">Cancelar</button></div>';
    if (c.err) h += '<div class="cs-err">' + E(c.err) + '</div>';
    return h + '</div>';
  }

  function msgHTML(it, t) {
    var m = it.msg, x = ctx(), mine = x.mode === 'persona' ? m.author_kind === 'paciente' : m.author_id === x.me;
    var who = m.author_kind === 'paciente' ? (x.mode === 'persona' ? 'Tú' : (ctl.patientName || 'La persona')) : (m.author_name || 'Profesional') + (m.author_role ? ' · ' + role(m.author_role) : '');
    if (m.hidden) return '<div class="cs-m hid">Mensaje entre profesionales · ' + E(who) + ' · ' + when(m.created_at) + '. No ves su contenido; lo que pase a tu hoja de vida sí lo ves.</div>';
    var h = '<div class="cs-m' + (mine ? ' mine' : '') + (m.unread && !mine ? ' unread' : '') + '"><div class="cs-meta"><b style="color:var(--ink)">' + E(who) + '</b> · ' + when(m.created_at) + ' · ' + E(audienceText(m, x.mode)) +
      (m.unread && !mine ? ' <span class="cs-pill new">Nuevo</span>' : '') + (x.me && (m.mentions || []).indexOf(x.me) >= 0 ? ' <span class="cs-pill men">Te mencionó</span>' : '') + (m.in_journal ? ' <span class="cs-pill hv">En la hoja de vida</span>' : '') + '</div>';
    if (m.retracted) return h + '<div class="cs-body cs-meta" style="font-style:italic">Mensaje retirado por su autor.</div></div>';
    if (ctl.editing && ctl.editing.id === m.id) {
      return h + '<div class="cs-comp" style="margin:6px 0"><textarea maxlength="' + MAX_BODY + '" oninput="SizigiaCaso.setEdit(this.value)">' + E(ctl.editing.body) + '</textarea>' +
        '<div class="cs-meta">La versión anterior queda guardada y visible para quienes leen este mensaje.</div><div class="cs-acts"><button class="btn primary small" onclick="SizigiaCaso.saveEdit()">Guardar</button><button class="btn small" onclick="SizigiaCaso.cancelEdit()">Cancelar</button></div>' +
        (ctl.editing.err ? '<div class="cs-err">' + E(ctl.editing.err) + '</div>' : '') + '</div></div>';
    }
    h += '<div class="cs-body">' + E(m.body) + '</div>' + filesHTML(m.files);
    if (it.edited) h += '<details class="cs-meta"><summary style="cursor:pointer">Editado · ' + it.history.length + (it.history.length === 1 ? ' versión anterior' : ' versiones anteriores') + '</summary>' + it.history.map(function (v) { return '<div style="margin:4px 0;white-space:pre-wrap"><b>' + when(v.created_at) + ':</b> ' + E(v.body || '') + '</div>'; }).join('') + '</details>';
    h += '<div class="cs-meta">' + E(readText(m, x.mode)) + '</div>';
    if (mine && !m.in_journal) h += '<div class="cs-acts"><button class="btn small" onclick="SizigiaCaso.edit(\'' + E(m.id) + '\')">Editar</button><button class="btn small" onclick="SizigiaCaso.promote(\'' + E(m.id) + '\')">Pasar a la hoja de vida</button><button class="btn small" onclick="SizigiaCaso.retract(\'' + E(m.id) + '\')">Retirar</button></div>';
    return h + '</div>';
  }

  function filesHTML(files) {
    if (!files || !files.length) return '';
    return '<div class="cs-files">' + files.map(function (f) {
      var u = ctl.urls[f.id], img = /^image\//.test(f.mime_type);
      var h = '<div class="cs-file"><span>Adjunto: ' + E(f.file_name) + ' <span class="cs-meta">· ' + sizeText(f.size_bytes) + '</span></span>';
      if (!u) h += '<button class="btn small" onclick="SizigiaCaso.openFile(\'' + E(f.id) + '\')">Ver</button>';
      else if (u === 'cargando') h += '<span class="cs-meta">Abriendo…</span>';
      else if (u === 'error') h += '<span class="cs-err" style="margin:0">No se pudo abrir.</span> <button class="btn small" onclick="SizigiaCaso.openFile(\'' + E(f.id) + '\')">Reintentar</button>';
      else h += '<a class="btn small" target="_blank" rel="noopener" href="' + E(u) + '">Abrir</a><button class="btn small" onclick="SizigiaCaso.hideFile(\'' + E(f.id) + '\')">Ocultar</button>' + (img ? '<img src="' + E(u) + '" alt="' + E(f.file_name) + '">' : '');
      return h + '</div>';
    }).join('') + '</div>';
  }

  function threadHTML(t) {
    var th = t.thread, open = ctl.openThread === th.id;
    var title = th.title || 'Conversación entre profesionales';
    var h = '<div class="cs-th"><button class="cs-th-h" onclick="SizigiaCaso.toggle(\'' + E(th.id) + '\')" aria-expanded="' + open + '"><span><b>' + E(title) + '</b><span class="cs-meta">' +
      E(TOPIC_BY[th.topic] ? TOPIC_BY[th.topic].label : th.topic) + (th.title && th.ref_label ? ' · ' + E(th.ref_label) : '') + ' · ' + t.items.length + (t.items.length === 1 ? ' mensaje' : ' mensajes') + (t.people.length ? ' · ' + E(joinNames(t.people)) : '') + ' · último ' + when(t.lastAt) + '</span></span><span style="white-space:nowrap">' +
      (t.mentions ? '<span class="cs-pill men">@ ' + t.mentions + '</span> ' : '') + (t.unread ? '<span class="cs-pill new">' + t.unread + ' sin leer</span> ' : '') + (open ? '▲' : '▼') + '</span></button>';
    if (!open) return h + '</div>';
    h += '<div class="cs-msgs">' + t.items.map(function (it) { return msgHTML(it, t); }).join('');
    if (t.onlyHidden) h += '<div class="cs-meta" style="margin-top:6px">Tus profesionales conversaron sobre ' + E((TOPIC_BY[th.topic] || {}).label || '').toLowerCase() + '. Si quieres saber más, pregúntales.</div>';
    else if (ctl.comp && ctl.comp.thread === th.id) h += compHTML();
    else h += '<div class="cs-acts" style="margin-top:8px"><button class="btn small" onclick="SizigiaCaso.reply(\'' + E(th.id) + '\')">Responder</button></div>';
    return h + '</div></div>';
  }

  function html() {
    if (!ctl) return '';
    ensureCss();
    var x = ctl.mode, h = '';
    if (ctl.err) return '<div class="cs-err">' + E(ctl.err) + '</div><div class="cs-acts"><button class="btn small" onclick="SizigiaCaso.reload()">Reintentar</button></div>';
    if (!ctl.data) return '<div class="cs-meta">Cargando…</div>';
    var team = ctl.data.team || [];
    if (x === 'pro') h += '<div class="cs-meta" style="margin-bottom:8px">Conversación del equipo de ' + E(ctl.patientName || 'la persona') + '. Cada mensaje queda guardado con autor, fecha, a quién fue y quién lo leyó; nada se borra. Abrir esta pestaña queda registrado y la persona lo ve.</div>';
    h += '<div class="cs-meta" style="margin-bottom:10px">En este caso: ' + (team.length ? team.map(function (p) { return E(p.name) + ' (' + E(role(p.role)) + ')'; }).join(', ') : 'nadie todavía') + '.</div>';
    if (ctl.flash) h += '<div class="cs-ok" style="margin-bottom:8px">' + ctl.flash + '</div>';
    var threads = buildThreads(ctl.data);
    var canWrite = x === 'pro' || topicsFor('persona', team, null).length;
    if (ctl.comp && !ctl.comp.thread) h += compHTML();
    else if (canWrite) h += '<div class="cs-acts" style="margin-bottom:10px"><button class="btn primary small" onclick="SizigiaCaso.compose()">Nuevo hilo</button></div>';
    if (!threads.length) h += '<div class="cs-meta">' + (x === 'pro' ? 'Todavía no hay mensajes. Abre un hilo para coordinar con el resto del equipo.' : canWrite ? 'Todavía no hay mensajes con tu equipo.' : 'Para conversar con tu equipo, dale a cada profesional el permiso "Conversación del equipo" en "Cambiar permisos".') + '</div>';
    return h + threads.map(threadHTML).join('');
  }

  async function load() {
    ctl.err = ''; ctl.data = null; changed();
    if (ctl.demo) { ctl.data = ctl.demoData || (ctl.demoData = demoFeed(ctl.mode, Date.now())); }
    else {
      var r = ctl.mode === 'pro' ? await ctl.sb.rpc('case_feed', { p_patient: ctl.patientId }) : await ctl.sb.rpc('my_case_feed');
      if (r.error) { ctl.err = errText(r.error, 'No se pudo cargar la conversación. Reintenta.'); return changed(); }
      ctl.data = r.data || {};
    }
    if (!ctl.openThread) { var t = buildThreads(ctl.data); ctl.openThread = t.length ? (t.filter(function (x) { return x.unread; })[0] || t[0]).thread.id : null; }
    changed();
    if (ctl.demo) setTimeout(function () { (ctl && ctl.data && ctl.data.messages || []).forEach(function (m) { m.unread = false; }); }, 0);
  }

  // opts: { mode: 'pro'|'persona', sb, demo, patientId, patientName, onChange }
  function open(opts) {
    var same = ctl && ctl.mode === opts.mode && ctl.patientId === opts.patientId;
    var keep = same ? { data: ctl.data, demoData: ctl.demoData, openThread: ctl.openThread } : {};
    ctl = Object.assign({ comp: null, editing: null, busy: false, flash: '', err: '', data: null, openThread: null, urls: {} }, keep, opts);
    if (opts.demo && opts.mode === 'pro') inbox.seen[opts.patientId] = true;
    if (!ctl.data) load(); else changed();
  }

  function demoPost(c) {
    var x = ctx(), r = recipients(c, x), id = 'd' + Date.now(), now = new Date().toISOString(), team = x.team, d = ctl.data;
    var thread = c.thread;
    if (!thread) { thread = 't' + Date.now(); d.threads.push({ id: thread, title: c.title.trim(), topic: c.topic, ref_kind: c.ref ? c.ref.kind : null, ref_id: c.ref ? c.ref.id : null, ref_label: c.ref ? c.ref.label : null, created_at: now }); }
    var me = x.me ? team.filter(function (p) { return p.id === x.me; })[0] : null;
    d.messages.push({ id: id, thread_id: thread, root_id: id, version: 1, author_kind: x.mode === 'pro' ? 'profesional' : 'paciente', author_id: x.me, author_name: me ? me.name : null, author_role: me ? me.role : null,
      body: c.body.trim(), retracted: false, audience: c.audience, patient_can_read: r.patient, in_journal: !!c.journal, created_at: now,
      to: r.pros.map(function (pid) { return { id: pid, name: nameOf(team, pid) }; }), mentions: c.mentions.slice(), reads: [], unread: false,
      files: c.files.map(function (f, k) { return { id: id + 'f' + k, file_name: f.name, mime_type: f.type, size_bytes: f.size, local_url: URL.createObjectURL(f) }; }) });
    return thread;
  }

  async function send() {
    var c = ctl.comp, x = ctx();
    if (!c || ctl.busy) return;
    c.err = validate(c, x) || validateFiles(c.files) || '';
    if (c.err) return changed();
    var mentioned = c.mentions.map(function (id) { return nameOf(x.team, id); });
    ctl.busy = true; changed();
    var thread;
    if (ctl.demo) thread = demoPost(c);
    else {
      var r = recipients(c, x), up = [];
      if (c.files.length) {
        up = await uploadFiles(c.files);
        if (up.error) { ctl.busy = false; c.err = up.error; return changed(); }
      }
      var args = { p_patient: ctl.patientId, p_thread: c.thread, p_title: c.thread ? null : c.title.trim(), p_topic: c.thread ? null : c.topic,
        p_ref_kind: c.ref ? c.ref.kind : null, p_ref_id: c.ref ? c.ref.id : null, p_body: c.body.trim(), p_audience: c.audience, p_to: c.audience === 'directo' ? r.pros : null,
        p_with_patient: !!c.withPatient, p_mentions: c.mentions, p_journal_kind: c.journal || null };
      if (up.length) args.p_files = up;
      var res = await ctl.sb.rpc(up.length ? 'post_case_message_files' : 'post_case_message', args);
      if (res.error) {
        if (up.length) await ctl.sb.storage.from('caso').remove(up.map(function (f) { return f.path; }));
        ctl.busy = false; c.err = errText(res.error, 'No se pudo enviar. Reintenta.'); return changed();
      }
      thread = c.thread;
    }
    ctl.busy = false; ctl.comp = null;
    ctl.flash = 'Enviado' + (c.journal ? ' y guardado en la hoja de vida' : '') + '.' +
      (mentioned.length && x.mode === 'pro' ? ' <a target="_blank" rel="noopener" href="' + E(waNotify(mentioned, ctl.patientName || 'la persona')) + '">Avisar por WhatsApp a ' + E(joinNames(mentioned)) + '</a> (sin el contenido del mensaje).' : '');
    if (ctl.demo) { ctl.openThread = thread; return changed(); }
    var keepOpen = thread; await load(); if (keepOpen) ctl.openThread = keepOpen; else { var t = buildThreads(ctl.data); ctl.openThread = t.length ? t[0].thread.id : null; } changed();
  }

  // Sube los archivos a la carpeta de la persona. Si uno falla, borra los ya subidos.
  async function uploadFiles(files) {
    var s = await ctl.sb.auth.getSession(), uid = s.data && s.data.session && s.data.session.user.id, out = [], bucket = ctl.sb.storage.from('caso');
    if (!uid) return { error: 'Tu sesión expiró. Vuelve a entrar.' };
    for (var k = 0; k < files.length; k++) {
      var f = files[k], path = filePath(ctl.patientId, uid, f.type, Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
      var u = await bucket.upload(path, f, { contentType: f.type, upsert: false });
      if (u.error) {
        if (out.length) await bucket.remove(out.map(function (x) { return x.path; }));
        return { error: 'No se pudo subir "' + f.name + '". Reintenta.' };
      }
      out.push({ path: path, file_name: f.name, mime_type: f.type, size_bytes: f.size });
    }
    return out;
  }
  function findFile(id) {
    var hit = null;
    (ctl.data.messages || []).forEach(function (m) { (m.files || []).forEach(function (f) { if (f.id === id) hit = f; }); });
    return hit;
  }
  // Abrir un adjunto: open_case_file valida, registra y habilita; después se firma una URL de 5 minutos.
  async function openFile(id) {
    var f = findFile(id);
    if (!f) return;
    if (f.local_url) { ctl.urls[id] = f.local_url; return changed(); }
    ctl.urls[id] = 'cargando'; changed();
    var r = await ctl.sb.rpc('open_case_file', { p_id: id });
    var s = r.error ? r : await ctl.sb.storage.from('caso').createSignedUrl(r.data, 300);
    ctl.urls[id] = s.error ? 'error' : s.data.signedUrl;
    changed();
  }

  function findMsg(id) { return (ctl.data.messages || []).filter(function (m) { return m.id === id; })[0]; }
  async function act(rpc, args, demoFn, okText) {
    if (ctl.demo) { demoFn(); ctl.flash = okText; return changed(); }
    var r = await ctl.sb.rpc(rpc, args);
    if (r.error) { ctl.flash = ''; alert(errText(r.error, 'No se pudo guardar. Reintenta.')); return; }
    ctl.flash = okText; await load();
  }

  root.SizigiaCaso = Object.assign({}, core, {
    open: open, html: html, reload: function () { if (ctl) load(); },
    close: function () { ctl = null; },
    compose: function () { ctl.comp = newComp(null); ctl.flash = ''; changed(); },
    reply: function (tid) { var t = buildThreads(ctl.data).filter(function (x) { return x.thread.id === tid; })[0]; ctl.comp = newComp(t); ctl.flash = ''; changed(); },
    cancel: function () { ctl.comp = null; changed(); },
    toggle: function (tid) { ctl.openThread = ctl.openThread === tid ? null : tid; if (ctl.comp && ctl.comp.thread) ctl.comp = null; changed(); },
    set: function (k, v, rerender) { ctl.comp[k] = v; if (rerender || k === 'journal') changed(); },
    setTopic: function (v) { var c = ctl.comp; c.topic = v; c.ref = null; var ok = readersFor(ctl.data.team, v, ctl.data.me).map(function (p) { return p.id; }); c.to = c.to.filter(function (id) { return ok.indexOf(id) >= 0; }); c.mentions = c.mentions.filter(function (id) { return ok.indexOf(id) >= 0; }); changed(); },
    setRef: function (kind, id) { var o = (ctl.data.refs[kind] || []).filter(function (x) { return x.id === id; })[0]; ctl.comp.ref = o ? { kind: kind, id: o.id, label: o.label } : null; },
    setAudience: function (v) { var c = ctl.comp; c.audience = v; var r = recipients(c, ctx()); c.mentions = c.mentions.filter(function (id) { return r.pros.indexOf(id) >= 0; }); changed(); },
    toggleTo: function (id, on) { var c = ctl.comp; c.to = on ? uniq(c.to.concat([id])) : c.to.filter(function (x) { return x !== id; }); if (!on) c.mentions = c.mentions.filter(function (x) { return x !== id; }); changed(); },
    toggleMention: function (id, on) { var c = ctl.comp; c.mentions = on ? uniq(c.mentions.concat([id])) : c.mentions.filter(function (x) { return x !== id; }); },
    send: send,
    addFiles: function (input) {
      var c = ctl.comp, add = Array.prototype.slice.call(input.files || []);
      input.value = '';
      var err = validateFiles(c.files.concat(add));
      if (err) { c.err = err; return changed(); }
      c.files = c.files.concat(add); c.err = ''; changed();
    },
    removeFile: function (k) { ctl.comp.files.splice(k, 1); ctl.comp.err = ''; changed(); },
    openFile: openFile,
    hideFile: function (id) { delete ctl.urls[id]; changed(); },
    edit: function (id) { var m = findMsg(id); ctl.editing = { id: id, body: m.body, err: '' }; changed(); },
    setEdit: function (v) { ctl.editing.body = v; },
    cancelEdit: function () { ctl.editing = null; changed(); },
    saveEdit: async function () {
      var e = ctl.editing, body = String(e.body || '').trim();
      if (!body || body.length > MAX_BODY) { e.err = 'Escribe el mensaje (máximo ' + MAX_BODY + ' caracteres).'; return changed(); }
      var m = findMsg(e.id); ctl.editing = null;
      await act('edit_case_message', { p_id: e.id, p_body: body }, function () {
        m.unread = false;
        ctl.data.messages.push(Object.assign({}, m, { id: 'd' + Date.now(), version: m.version + 1, body: body, created_at: new Date().toISOString(), reads: [] }));
      }, 'Mensaje editado. La versión anterior queda guardada.');
    },
    retract: function (id) {
      if (!window.confirm('¿Retirar este mensaje? Su texto deja de verse, pero queda registro de que existió.')) return;
      var m = findMsg(id);
      act('retract_case_message', { p_id: id }, function () { ctl.data.messages.forEach(function (x) { if (x.root_id === m.root_id) { x.retracted = true; x.body = null; } }); }, 'Mensaje retirado.');
    },
    promote: function (id) {
      var kind = ctl.mode === 'pro' && window.confirm('¿Es el resumen o la transcripción de una consulta?\nAceptar: consulta. Cancelar: nota.') ? 'consulta' : 'nota';
      if (!window.confirm('Pasar a la hoja de vida como ' + kind + '. La persona lo verá ahí y después no se puede editar ni retirar. ¿Seguir?')) return;
      var m = findMsg(id);
      act('promote_case_message', { p_id: id, p_kind: kind }, function () { m.in_journal = true; }, 'Guardado en la hoja de vida.');
    },

    // Bandeja del profesional (panel): personas con mensajes sin leer, sin contenido. El hook lo pone panel-coach.js.
    mountInbox: function (opts) { inbox.sb = opts.sb || null; inbox.demo = !!opts.demo; inbox.rows = null; inbox.loading = false; },
    inboxHTML: function () {
      if (inbox.rows == null) { loadInbox(); return '<div id="cs_inbox"></div>'; }
      return '<div id="cs_inbox">' + inboxInner() + '</div>';
    },
    refreshInbox: function () { inbox.rows = null; loadInbox(); },
    // Tarjeta de la persona dentro de "Mi equipo" (hook en mi-equipo.js). Se dibuja sola en #cs_p.
    personaCard: function (opts) {
      var paint = function () { var el = document.getElementById('cs_p'); if (el) el.innerHTML = html(); };
      if (!ctl || ctl.mode !== 'persona') open(Object.assign({ mode: 'persona', onChange: paint }, opts));
      else ctl.onChange = paint;
      return '<div class="card" style="margin-bottom:16px"><h3>Conversación con mi equipo</h3><div class="card-sub">Escríbele a todo tu equipo o a quien elijas, por tema. Ves lo que te escriben; de lo que tus profesionales hablan solo entre ellos, ves que existe pero no el contenido. Lo que pasa a tu hoja de vida siempre lo ves.</div><div id="cs_p">' + html() + '</div></div>';
    }
  });

  function inboxInner() {
    var rows = inboxSort(inbox.rows || []);
    if (!rows.length) return '';
    ensureCss();
    return '<div class="cs-inbox"><b style="font-size:16px">Mensajes del equipo</b>' + rows.map(function (r) {
      return '<div class="cs-inbox-row"><span><b>' + E(r.patient_name) + '</b> <span class="cs-meta">' + r.unread + ' sin leer' + (Number(r.mentions) ? ' · <span class="cs-pill men">te mencionaron</span>' : '') + ' · ' + when(r.last_at) + '</span></span>' +
        '<button class="btn" onclick="SizigiaFicha.open(\'' + E(r.patient_id) + '\',\'equipo\')">Abrir caso</button></div>';
    }).join('') + '</div>';
  }
  async function loadInbox() {
    if (inbox.loading) return;
    inbox.loading = true;
    await null; // el contenedor #cs_inbox se inserta después de que inboxHTML() devuelve
    if (inbox.demo) inbox.rows = inbox.seen['demo-1'] ? [] : [{ patient_id: 'demo-1', patient_name: 'Matías Lacroix', unread: 2, mentions: 1, last_at: new Date(Date.now() - 20 * 3600000).toISOString() }];
    else if (inbox.sb) { var r = await inbox.sb.rpc('my_case_inbox'); inbox.rows = r.error ? [] : r.data || []; }
    else inbox.rows = [];
    inbox.loading = false;
    var el = document.getElementById('cs_inbox'); if (el) el.innerHTML = inboxInner();
  }
})(typeof window !== 'undefined' ? window : globalThis);
