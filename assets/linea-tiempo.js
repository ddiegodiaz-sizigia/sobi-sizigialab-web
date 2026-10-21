// Línea de tiempo única de la hoja de vida (fase 3 del rediseño). Mismo núcleo para la persona (Mi historia, persona.js)
// y para el profesional (portada de la ficha, ficha-profesional.js): entradas de journal_entries más las consultas,
// agrupadas por mes, con tema, quién lo registró y filtros. El profesional lee por patient_timeline(p_patient)
// (supabase/migrations/20261030_linea_tiempo.sql), que solo devuelve los temas que tiene autorizados y registra el acceso.
// Núcleo puro exportado para Node (tests/linea-tiempo.test.mjs).
(function (root) {
  'use strict';
  var KINDS = { nota: 'Nota', consulta: 'Consulta', examen: 'Examen', lesion: 'Lesión', plan: 'Plan', hito: 'Hito', objetivo: 'Objetivo', suplemento: 'Suplemento', medicamento: 'Medicamento' };
  var TOPICS = { bitacora: 'General', lesiones: 'Lesiones', examenes: 'Exámenes', nutricion: 'Nutrición', salud_mental: 'Salud mental', ciclo: 'Ciclo' };
  var ROLES = { medico: 'médico', entrenador: 'entrenador', preparador: 'preparador físico', psicologo: 'psicólogo', nutricionista: 'nutricionista', kinesiologo: 'kinesiólogo', familia: 'familia', otro: '' };
  var AUTHORS = { paciente: 'La persona', profesional: 'Profesional', admin: 'Sizigia Lab' };
  var MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Une entradas de la hoja de vida y consultas en una sola lista, de la más reciente a la más antigua.
  // entries: filas de journal_entries (o de patient_timeline); sessions: consultas (state.sessions de la app de la persona).
  function build(entries, sessions) {
    var items = (entries || []).map(function (j) {
      return { id: j.id, date: j.entry_date, kind: KINDS[j.kind] ? j.kind : 'nota', scope: TOPICS[j.scope] ? j.scope : 'bitacora', title: j.title || '', body: j.body || '',
        author: AUTHORS[j.author_kind] ? j.author_kind : 'paciente', authorName: j.author_name || null, authorRole: j.author_role || null, at: j.created_at || '' };
    });
    (sessions || []).forEach(function (s) {
      items.push({ id: 's-' + s.id, date: s.date, kind: 'consulta', scope: 'bitacora', title: s.title || 'Consulta', body: s.summary || '', author: 'profesional', authorName: null, authorRole: null, at: '', session: s.id });
    });
    return items.filter(function (i) { return !!i.date; }).sort(function (a, b) {
      return a.date !== b.date ? (a.date < b.date ? 1 : -1) : (a.at < b.at ? 1 : a.at > b.at ? -1 : 0);
    });
  }

  // Quién lo registró, según quién mira ('persona' o 'pro').
  function authorLabel(item, viewer) {
    if (item.author === 'paciente') return viewer === 'persona' ? 'Tú' : 'La persona';
    if (item.author === 'admin') return 'Equipo Sizigia Lab';
    var role = ROLES[item.authorRole] || '';
    if (item.authorName) return item.authorName + (role ? ' (' + role + ')' : '');
    return viewer === 'persona' ? 'Tu equipo' : 'Profesional';
  }

  // f: { topic: 'todos'|scope, author: 'todos'|'paciente'|'profesional'|'admin' }
  function filter(items, f) {
    f = f || {};
    return (items || []).filter(function (i) {
      return (!f.topic || f.topic === 'todos' || i.scope === f.topic) && (!f.author || f.author === 'todos' || i.author === f.author);
    });
  }
  // Temas y autores presentes, para mostrar solo los filtros que sirven.
  function facets(items) {
    var t = {}, a = {};
    (items || []).forEach(function (i) { t[i.scope] = (t[i.scope] || 0) + 1; a[i.author] = (a[i.author] || 0) + 1; });
    return { topics: Object.keys(TOPICS).filter(function (k) { return t[k]; }), authors: Object.keys(AUTHORS).filter(function (k) { return a[k]; }) };
  }
  function byMonth(items) {
    var out = [], cur = null;
    (items || []).forEach(function (i) {
      var k = i.date.slice(0, 7);
      if (!cur || cur.key !== k) { cur = { key: k, label: MONTHS[Number(k.slice(5, 7)) - 1] + ' ' + k.slice(0, 4), items: [] }; out.push(cur); }
      cur.items.push(i);
    });
    return out;
  }
  function dm(iso) { return Number(iso.slice(8, 10)) + ' ' + MONTHS[Number(iso.slice(5, 7)) - 1].slice(0, 3).toLowerCase(); }

  // HTML de la línea de tiempo. o: { E (escape), viewer, filters: {topic, author}, onTopic, onAuthor (nombres de función global), limit }
  function html(items, o) {
    var E = o.E, f = o.filters || {}, fc = facets(items), list = filter(items, f), h = '';
    var chip = function (fn, k, label, on) { return '<button type="button" class="lt-chip' + (on ? ' on' : '') + '" onclick="' + fn + '(\'' + k + '\')">' + E(label) + '</button>'; };
    if (fc.topics.length > 1) h += '<div class="lt-chips" aria-label="Tema">' + chip(o.onTopic, 'todos', 'Todo', !f.topic || f.topic === 'todos') + fc.topics.map(function (k) { return chip(o.onTopic, k, TOPICS[k], f.topic === k); }).join('') + '</div>';
    if (fc.authors.length > 1) h += '<div class="lt-chips" aria-label="Quién">' + chip(o.onAuthor, 'todos', 'Todos', !f.author || f.author === 'todos') + fc.authors.map(function (k) {
      return chip(o.onAuthor, k, k === 'paciente' ? (o.viewer === 'persona' ? 'Lo que registré' : 'La persona') : k === 'profesional' ? (o.viewer === 'persona' ? 'Mi equipo' : 'Profesionales') : 'Sizigia Lab', f.author === k);
    }).join('') + '</div>';
    if (!list.length) return h + '<div class="lt-empty">' + (items.length ? 'Nada con estos filtros.' : 'Aún no hay entradas en la hoja de vida.') + '</div>';
    var shown = o.limit ? list.slice(0, o.limit) : list;
    h += byMonth(shown).map(function (m) {
      return '<div class="lt-month">' + E(m.label) + '</div><div class="lt-list">' + m.items.map(function (i) {
        return '<div class="lt-item"><div class="lt-date">' + E(dm(i.date)) + '</div><div class="lt-main"><div class="lt-meta">' + E(KINDS[i.kind]) + (i.scope !== 'bitacora' ? ' · ' + E(TOPICS[i.scope]) : '') + ' · ' + E(authorLabel(i, o.viewer)) + '</div>' +
          '<div class="lt-ttl">' + E(i.title) + '</div>' + (i.body ? '<div class="lt-bd">' + E(i.body) + '</div>' : '') + '</div></div>';
      }).join('') + '</div>';
    }).join('');
    if (shown.length < list.length) h += '<div class="lt-empty">' + (list.length - shown.length) + ' entradas más antiguas.</div>';
    return h;
  }
  var CSS = '.lt-chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.lt-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 12px;font-size:14px;cursor:pointer;font-family:inherit;color:var(--ink)}' +
    '.lt-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}.lt-month{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:18px 0 6px}' +
    '.lt-list{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}.lt-item{display:flex;gap:14px;padding:12px 14px;border-top:1px solid var(--line)}.lt-item:first-child{border-top:none}' +
    '.lt-date{flex:none;width:52px;font-size:14px;color:var(--muted);padding-top:1px}.lt-main{flex:1;min-width:0}.lt-meta{font-size:13px;color:var(--muted)}.lt-ttl{font-weight:600;font-size:16px;margin-top:1px}' +
    '.lt-bd{font-size:15px;margin-top:3px;white-space:pre-wrap;line-height:1.5}.lt-empty{font-size:15px;color:var(--muted);padding:14px 0}';
  function ensureCss() { if (typeof document !== 'undefined' && !document.getElementById('lt-css')) { var s = document.createElement('style'); s.id = 'lt-css'; s.textContent = CSS; document.head.appendChild(s); } }

  var api = { KINDS: KINDS, TOPICS: TOPICS, build: build, authorLabel: authorLabel, filter: filter, facets: facets, byMonth: byMonth, html: html, ensureCss: ensureCss };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SizigiaLinea = api;
})(typeof window !== 'undefined' ? window : globalThis);
