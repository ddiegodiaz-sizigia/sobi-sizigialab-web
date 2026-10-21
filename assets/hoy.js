// Versión nueva de la app de la persona (fase 2 del rediseño): pantalla Hoy y cuatro espacios con barra inferior
// (Hoy, Mi historia, Mi cuerpo, Mi equipo). Es la versión por defecto; ?v=1 o "Volver a la versión anterior" vuelven a la anterior
// (queda guardado en este navegador) y ?v=2 la reactiva.
// Reutiliza las pantallas que ya existen; el registro del día es assets/registro-diario.js.
// Núcleo puro exportado para Node (tests/hoy.test.mjs). La pantalla usa los globals de rueda_final.html.
(function (root) {
  'use strict';

  // ---------- Núcleo puro ----------
  var SPACES = {
    hoy: { label: 'Hoy', subs: [] },
    historia: { label: 'Mi historia', subs: [['bitacora', 'Línea de tiempo'], ['tendencias', 'Tendencias'], ['sesiones', 'Consultas']] },
    cuerpo: { label: 'Mi cuerpo', subs: [['medidas', 'Medidas'], ['examenes', 'Exámenes'], ['lesiones', 'Lesiones'], ['nutricion', 'Nutrición']] },
    equipo: { label: 'Mi equipo', subs: [['equipo', 'Equipo y permisos'], ['perfil', 'Mi registro y perfil'], ['recursos', 'Recursos'], ['data', 'Mis datos']] }
  };
  var ORDER = ['hoy', 'historia', 'cuerpo', 'equipo'];

  function addDays(iso, n) { var d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000); return d.toISOString().slice(0, 10); }
  function fmt(v, dec) { return (dec ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))).replace('.', ','); }

  // Navegación válida: espacio conocido y una sub-sección de ese espacio.
  function normalizeNav(nav) {
    nav = nav || {};
    var space = SPACES[nav.space] ? nav.space : 'hoy', sub = {};
    ORDER.forEach(function (k) {
      var subs = SPACES[k].subs, want = (nav.sub || {})[k];
      if (subs.length) sub[k] = subs.some(function (s) { return s[0] === want; }) ? want : subs[0][0];
    });
    return { space: space, sub: sub };
  }

  // Último valor reciente frente al promedio de los días anteriores.
  // points: [{iso, value}]; opts: { maxAge (días, def. 2), window (días, def. 14), step (umbral, def. 0.5), dec }
  function indicator(points, today, opts) {
    opts = opts || {};
    var maxAge = opts.maxAge == null ? 2 : opts.maxAge, win = opts.window || 14, step = opts.step == null ? 0.5 : opts.step;
    var pts = (points || []).filter(function (p) { return p && p.value != null && !isNaN(p.value) && p.iso <= today; })
      .sort(function (a, b) { return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0; });
    var last = pts[pts.length - 1];
    if (!last || last.iso < addDays(today, -maxAge)) return { value: null, avg: null, dir: null, text: 'Sin registro reciente' };
    var from = addDays(last.iso, -win), prev = pts.filter(function (p) { return p.iso >= from && p.iso < last.iso; });
    var avg = prev.length >= 3 ? prev.reduce(function (s, p) { return s + Number(p.value); }, 0) / prev.length : null;
    var value = Number(last.value);
    if (avg == null) return { value: value, avg: null, dir: null, date: last.iso, text: 'Aún sin promedio para comparar' };
    var d = value - avg, dir = d >= step ? 'up' : d <= -step ? 'down' : 'flat';
    var text = dir === 'flat' ? 'Como tu promedio (' + fmt(avg, opts.dec) + ')' : (dir === 'up' ? 'Sobre' : 'Bajo') + ' tu promedio (' + fmt(avg, opts.dec) + ')';
    return { value: value, avg: avg, dir: dir, date: last.iso, text: text };
  }

  // Lectura del día en una frase, a partir del semáforo. sem: { level, reasons: [{text}] }; done: ya registró.
  function reading(sem, done) {
    sem = sem || { level: 'gris', reasons: [] };
    var reasons = sem.reasons || [], first = reasons[0] && reasons[0].text, more = reasons.length - 1;
    var extra = more > 0 ? ' Y ' + more + (more === 1 ? ' señal más.' : ' señales más.') : '';
    if (sem.level === 'rojo') return { tone: 'rojo', word: 'Atención', title: first || 'Hay una señal para revisar', text: 'Conviene revisar tu carga con tu equipo antes de entrenar fuerte.' + extra };
    if (sem.level === 'amarillo') return { tone: 'amarillo', word: 'Precaución', title: first || 'Hay algo que mirar', text: 'Si se mantiene, conversa con tu equipo.' + extra };
    if (sem.level === 'verde') return { tone: 'verde', word: 'Todo en orden', title: 'Sin alertas en lo que registraste', text: done ? 'Buen trabajo registrando: así tu equipo te acompaña mejor.' : 'Registra hoy para mantener tu lectura al día.' };
    return { tone: 'gris', word: 'Sin lectura', title: done ? 'Aún faltan datos para calcular tu lectura' : 'Aún no registras hoy', text: done ? 'Se completa con unos días más de registro.' : 'Tu lectura se actualiza en cuanto registras.' };
  }

  // Tercer indicador: dolor si hay lesión abierta, ciclo si lo registra; si no, ánimo (deportivo) o hábitos/estrés (general).
  function thirdMetric(ctx) {
    if (ctx.injuries) return 'dolor';
    if (ctx.cycle) return 'ciclo';
    if (ctx.mode === 'comun') return ctx.habits ? 'habitos' : 'estres';
    return 'animo';
  }

  // "Lo que viene": máximo tres pendientes concretos, cada uno con su destino. in: { unread, meals: {meals, logged}|null, profileMissing }
  function upcoming(input) {
    input = input || {};
    var out = [], n = Number(input.unread) || 0, m = input.meals;
    if (n > 0) out.push({ key: 'mensajes', text: n === 1 ? 'Tienes un mensaje nuevo de tu equipo' : 'Tienes ' + n + ' mensajes nuevos de tu equipo', space: 'equipo', sub: 'equipo' });
    if (m && m.meals > 0 && m.logged < m.meals) out.push({ key: 'comidas', text: m.logged ? 'Registraste ' + m.logged + ' de ' + m.meals + ' comidas de tu plan de hoy' : 'Tu plan de hoy tiene ' + m.meals + (m.meals === 1 ? ' comida' : ' comidas') + ' por registrar', space: 'cuerpo', sub: 'nutricion' });
    if (input.profileMissing) out.push({ key: 'perfil', text: 'Completa tu perfil para ajustar tus referencias', space: 'equipo', sub: 'perfil' });
    return out.slice(0, 3);
  }

  var core = { SPACES: SPACES, ORDER: ORDER, normalizeNav: normalizeNav, indicator: indicator, reading: reading, thirdMetric: thirdMetric, upcoming: upcoming };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var KEY = 'sizigiaV2';
  var flag = null;
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var TONES = { verde: ['#55704F', 'var(--green-bg)'], amarillo: ['#B8862B', 'var(--amber-bg)'], rojo: ['#A13D2D', 'var(--red-bg)'], gris: ['#8a8578', 'var(--gray-bg)'] };
  var ICONS = {
    hoy: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    historia: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
    cuerpo: '<path d="M12 21s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.6-7 10-7 10z"/><path d="M8 12h2l1-2 2 4 1-2h2"/>',
    equipo: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 7 0"/>'
  };
  function icon(k) { return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[k] + '</svg>'; }

  var css = '.v2{max-width:720px;margin:0 auto;padding-bottom:110px}' +
    '.v2-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:18px}.v2-brand{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--muted)}' +
    '.v2-brand .brand-mark{width:30px;height:30px;border-radius:8px}.v2-who{font-size:14px;color:var(--muted);text-align:right}' +
    '.v2-hello{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:30px;margin:0}.v2-date{color:var(--muted);font-size:15px;margin:2px 0 20px}' +
    '.v2-read{border-radius:16px;padding:20px;margin-bottom:16px}.v2-read .w{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}' +
    '.v2-read .dot{width:12px;height:12px;border-radius:50%}.v2-read h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:22px;line-height:1.3;margin:10px 0 6px}' +
    '.v2-read p{margin:0;font-size:16px;line-height:1.5}.v2-read .tc-note{margin-top:10px}' +
    '.v2-cta{display:block;width:100%;border:none;border-radius:14px;background:var(--accent);color:#fff;font-size:18px;font-weight:600;padding:16px;cursor:pointer;font-family:inherit}' +
    '.v2-cta small{display:block;font-size:13.5px;font-weight:400;opacity:.9;margin-top:2px}' +
    '.v2-done{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 16px;font-size:16px}' +
    '.v2-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:24px 0 8px}.v2-tile{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 12px}' +
    '.v2-tile .l{font-size:13.5px;color:var(--muted)}.v2-tile .v{font-size:26px;font-weight:700;margin:4px 0 2px}.v2-tile .v small{font-size:14px;font-weight:600;color:var(--muted)}' +
    '.v2-h3{font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:22px 0 8px}' +
    '.v2-next{background:var(--paper);border:1px solid var(--line);border-radius:14px;overflow:hidden}.v2-next button{display:flex;justify-content:space-between;align-items:center;gap:10px;width:100%;border:none;border-top:1px solid var(--line);background:none;padding:14px 16px;font-size:16px;text-align:left;cursor:pointer;font-family:inherit;color:var(--ink)}.v2-next button:first-child{border-top:none}.v2-next button span:last-child{color:var(--muted);font-size:20px}' +
    '.v2-tile .s{font-size:13px;color:var(--muted);line-height:1.35}.v2-link{border:none;background:none;color:var(--accent-dark);font-size:15px;font-weight:600;cursor:pointer;padding:8px 0;font-family:inherit}' +
    '@media (max-width:420px){.v2-tiles{gap:8px}.v2-tile{padding:12px 9px}.v2-tile .v{font-size:22px}}' +
    '.v2-sub{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;margin:0 0 18px;padding-bottom:2px}.v2-sub::-webkit-scrollbar{display:none}' +
    '.v2-sub button{flex:none;border:1px solid var(--line);background:var(--paper);border-radius:999px;padding:8px 14px;font-size:15px;cursor:pointer;font-family:inherit;color:var(--ink)}' +
    '.v2-sub button.on{background:var(--ink);border-color:var(--ink);color:#fff}.v2-title{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:26px;margin:0 0 14px}' +
    '.v2-nav{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:560px;background:var(--paper);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(5,1fr);align-items:center;padding:6px 4px calc(6px + env(safe-area-inset-bottom));z-index:50;box-sizing:border-box}' +
    '@media (min-width:700px){.v2-nav{bottom:16px;border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow-md)}}' +
    '.v2-nav button{border:none;background:none;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11.5px;color:var(--muted);cursor:pointer;font-family:inherit;padding:4px 0}' +
    '.v2-nav button.on{color:var(--ink);font-weight:700}.v2-nav .plus{width:48px;height:48px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-size:28px;line-height:1;margin:0 auto}';
  function ensureCss() { if (!document.getElementById('hoy-css')) { var s = document.createElement('style'); s.id = 'hoy-css'; s.textContent = css; document.head.appendChild(s); } }

  function active() {
    if (flag !== null) return flag;
    var v = new URLSearchParams(root.location.search).get('v');
    try {
      if (v === '2') localStorage.setItem(KEY, '1');
      if (v === '1') localStorage.setItem(KEY, '0');
      flag = localStorage.getItem(KEY) !== '0';
    } catch (e) { flag = v !== '1'; }
    return flag;
  }
  function nav() { state.ui.v2 = normalizeNav(state.ui.v2); return state.ui.v2; }
  function go(space, sub) {
    var n = nav();
    n.space = SPACES[space] ? space : 'hoy';
    if (sub) n.sub[n.space] = sub;
    state.ui.v2 = normalizeNav(n); saveState(); render(); root.scrollTo(0, 0);
  }

  function comun() { return !!(root.SizigiaRegistro && root.SizigiaRegistro.isComun()); }
  function weekly() { return comun() && root.SizigiaRegistro.settings().frequency === 'semanal'; }
  function athletePoints(key) {
    var logs = athleteLogs();
    return Object.keys(logs).map(function (iso) { var v = logs[iso][key]; return v == null || v === '' ? null : { iso: iso, value: Number(v) }; }).filter(Boolean);
  }
  function tile(label, ind, unit, dec, fallback) {
    var v = ind && ind.value != null ? fmt(ind.value, dec) : '—';
    return '<div class="v2-tile"><div class="l">' + E(label) + '</div><div class="v">' + E(v) + (ind && ind.value != null && unit ? ' <small>' + E(unit) + '</small>' : '') + '</div><div class="s">' + E(ind ? ind.text : fallback || '') + '</div></div>';
  }
  function tiles() {
    var t = todayISO(), R = root.SizigiaRegistro, wk = weekly(), age = wk ? 13 : 2, win = wk ? 56 : 14;
    var inj = root.SizigiaLesiones ? root.SizigiaLesiones.openToday() : [], cyc = root.SizigiaPersona && root.SizigiaPersona.tracksCycle();
    var habits = comun() && R.settings().habits.length > 0, third = thirdMetric({ injuries: inj.length > 0, cycle: cyc, mode: comun() ? 'comun' : 'deportivo', habits: habits });
    var pts = function (m) { return comun() ? R.trendPoints(m) : athletePoints(m); };
    var h = '<div class="v2-tiles">';
    h += tile('Sueño', indicator(pts(comun() ? 'sleep' : 'sleep_hours'), t, { maxAge: age, window: win, dec: true }), 'h', true);
    h += comun() ? tile('Energía', indicator(pts('energy'), t, { maxAge: age, window: win }), '/10') : tile('Fatiga', indicator(pts('fatigue'), t), '/10');
    if (third === 'dolor') {
      var top = inj.slice().sort(function (a, b) { return (b.eva != null ? b.eva : b.last || 0) - (a.eva != null ? a.eva : a.last || 0); })[0];
      var val = top.eva != null ? top.eva : top.last;
      h += '<div class="v2-tile"><div class="l">Dolor · ' + E(top.name.split(' (')[0]) + '</div><div class="v">' + (val != null ? val + ' <small>/10</small>' : '—') + '</div><div class="s">' + E(top.eva != null ? 'Registrado hoy' : 'Último registro') + (inj.length > 1 ? ' · ' + inj.length + ' lesiones abiertas' : '') + '</div></div>';
    } else if (third === 'ciclo') {
      var day = root.SizigiaPersona.cycleDay();
      h += '<div class="v2-tile"><div class="l">Ciclo</div><div class="v">' + (day ? 'Día ' + day : '—') + '</div><div class="s">' + E(day ? 'Según tus registros' : 'Registra tu ciclo para verlo') + '</div></div>';
    } else if (third === 'habitos') h += tile('Hábitos', indicator(pts('habits'), t, { maxAge: age, window: win, step: 10 }), '%');
    else if (third === 'estres') h += tile('Estrés', indicator(pts('stress'), t, { maxAge: age, window: win }), '/10');
    else h += tile('Ánimo', indicator(pts('mood'), t), '/10');
    return h + '</div>';
  }

  function hoyHTML() {
    var t = todayISO(), first = (state.patient.name || '').trim().split(' ')[0] || '', done = root.SizigiaDiario ? root.SizigiaDiario.doneToday() : false;
    var sem = root.SizigiaPersona ? root.SizigiaPersona.semaforo() : { level: 'gris', reasons: [] }, rd = reading(sem, done), tone = TONES[rd.tone];
    var date = new Date(t + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
    date = date.charAt(0).toUpperCase() + date.slice(1);
    var h = '<h1 class="v2-hello">Hola' + (first ? ', ' + E(first) : '') + '</h1><div class="v2-date">' + E(date) + '</div>';
    h += '<section class="v2-read" style="background:' + tone[1] + '"><div class="w" style="color:' + tone[0] + '"><span class="dot" style="background:' + tone[0] + '"></span>' + E(rd.word) + '</div>';
    h += '<h2>' + E(rd.title) + '</h2><p>' + E(rd.text) + '</p>';
    if (typeof semChecksHTML === 'function' && (sem.checks || []).length) h += semChecksHTML(sem.checks, sem.why || '', escapeHtml);
    h += '<div class="tc-note">Lectura informativa calculada con lo que registras. No es un diagnóstico.</div></section>';
    var what = weekly() ? 'semana' : 'día';
    h += done
      ? '<div class="v2-done"><span>Ya registraste ' + (weekly() ? 'esta semana' : 'hoy') + '.</span><button class="btn small" onclick="SizigiaDiario.open()">Editar</button></div>'
      : '<button class="v2-cta" onclick="SizigiaDiario.open()">Registrar mi ' + what + '<small>Menos de 30 segundos</small></button>';
    h += tiles();
    h += '<button class="v2-link" onclick="SizigiaHoy.go(\'historia\',\'tendencias\')">Ver mis tendencias →</button>';
    var next = upcoming({ unread: unread(), meals: root.SizigiaNutricion ? root.SizigiaNutricion.todaySummary() : null, profileMissing: !!(state.profile && !state.profile.sex) });
    if (next.length) h += '<h3 class="v2-h3">Lo que viene</h3><div class="v2-next">' + next.map(function (x) {
      return '<button type="button" onclick="SizigiaHoy.go(\'' + x.space + '\',\'' + x.sub + '\')"><span>' + E(x.text) + '</span><span aria-hidden="true">›</span></button>';
    }).join('') + '</div>';
    return h;
  }
  // Mensajes del equipo sin leer (my_case_unread, sin contenido ni registro de acceso). Se pide una vez por sesión.
  var unreadState = { n: null, loading: false };
  function unread() {
    if (unreadState.n !== null || unreadState.loading) return unreadState.n || 0;
    if (isDemoMode) { unreadState.n = 1; return 1; }
    if (!currentPatientId) return 0;
    unreadState.loading = true;
    supabaseClient.rpc('my_case_unread').then(function (r) { unreadState.loading = false; unreadState.n = r.error ? 0 : Number(r.data) || 0; if (unreadState.n) render(); });
    return 0;
  }

  function subHTML(sub) {
    if (sub === 'bitacora') return root.SizigiaPersona.bitacoraTab();
    if (sub === 'tendencias') return root.SizigiaPersona.trendsCard();
    if (sub === 'sesiones') return renderSesiones();
    if (sub === 'medidas') return renderMedidas();
    if (sub === 'examenes') return root.SizigiaExamenes.tab();
    if (sub === 'lesiones') return root.SizigiaLesiones.tab();
    if (sub === 'nutricion') return root.SizigiaNutricion.tab();
    if (sub === 'equipo') return root.SizigiaEquipo.tab();
    if (sub === 'perfil') return root.SizigiaPersona.profileCard() + (root.SizigiaRegistro ? root.SizigiaRegistro.configCard() : '') +
      '<div class="card"><h3>Sesión</h3><div class="card-sub">' + E(currentUser ? currentUser.email : (state.patient.name || '')) + '</div><button class="btn small" onclick="handleLogout()">Salir</button> <button class="btn small" onclick="SizigiaHoy.classic()">Volver a la versión anterior</button></div>';
    if (sub === 'recursos') return renderRecursos();
    if (sub === 'data') return renderData();
    return '';
  }

  function navHTML(space) {
    var b = function (k) { return '<button type="button" class="' + (space === k ? 'on' : '') + '" onclick="SizigiaHoy.go(\'' + k + '\')"' + (space === k ? ' aria-current="page"' : '') + '>' + icon(k) + '<span>' + SPACES[k].label + '</span></button>'; };
    return '<nav class="v2-nav" aria-label="Secciones">' + b('hoy') + b('historia') +
      '<button type="button" onclick="SizigiaDiario.open()" aria-label="Registrar mi día"><span class="plus">+</span></button>' + b('cuerpo') + b('equipo') + '</nav>';
  }

  function renderApp(app) {
    ensureCss();
    var n = nav(), space = n.space, sub = n.sub[space];
    state.ui.tab = space === 'hoy' ? 'hoy' : sub; // compatibilidad con los afterRender de los módulos
    var h = '';
    if (isDemoMode) h += '<div style="background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:14px;font-weight:600;padding:8px 14px;border-radius:10px;margin-bottom:10px;text-align:center;">MODO DEMO — datos de prueba, no se guardan ni afectan pacientes reales</div>';
    h += '<div class="v2"><div class="v2-head"><div class="v2-brand"><div class="brand-mark"><span>MH</span></div>Mi Bitácora · Medicina Humana</div>';
    h += '<div class="v2-who">' + E(state.patient.name || (currentUser ? currentUser.email : '')) + '</div></div>';
    if (space === 'hoy') h += hoyHTML();
    else {
      h += '<h1 class="v2-title">' + E(SPACES[space].label) + '</h1><div class="v2-sub" role="tablist">' + SPACES[space].subs.map(function (s) {
        return '<button type="button" role="tab" class="' + (s[0] === sub ? 'on' : '') + '" aria-selected="' + (s[0] === sub) + '" onclick="SizigiaHoy.go(\'' + space + '\',\'' + s[0] + '\')">' + E(s[1]) + '</button>';
      }).join('') + '</div><div id="tabContent">' + subHTML(sub) + '</div>';
    }
    h += '</div>' + navHTML(space) + (root.SizigiaDiario ? root.SizigiaDiario.html() : '');
    app.innerHTML = h;
    try { root.SizigiaPersona.afterRender(); if (sub === 'tendencias' && space === 'historia') root.SizigiaPersona.mountTrend(); } catch (e) { console.warn('hoy afterRender', e); }
  }

  root.SizigiaHoy = Object.assign({}, core, {
    active: active, render: renderApp, go: go,
    classic: function () { try { localStorage.setItem(KEY, '0'); } catch (e) {} flag = false; state.ui.tab = 'resumen'; saveState(); render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
