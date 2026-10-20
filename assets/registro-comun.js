// Registro de persona común: energía, sueño, estrés y hábitos, sin RPE ni minutos de sesión. Diario o una vez por semana.
// Convive con el registro deportivo (athlete_logs): cada persona usa uno, según log_settings.mode ('deportivo' por defecto).
// Lo configura la persona o su coach (set_log_settings). El semáforo de este registro está en semaforo.js (SEM_RULES_COMUN).
// Backend: supabase/migrations/20261024_registro_comun.sql. Núcleo puro exportado para Node (tests/registro-comun.test.mjs).
// La pantalla usa los globals de rueda_final.html (state, supabaseClient, currentPatientId, isDemoMode, render, saveState,
// escapeHtml, todayISO, addDaysISO, fmtDate) y computeSemaforoComun de semaforo.js.
(function (root) {
  'use strict';
  var MODES = { deportivo: 'Deportivo', comun: 'General' };
  var FREQS = { diaria: 'Cada día', semanal: 'Una vez por semana' };
  var MAX_HABITS = 8;
  var SUGGESTED = ['Caminar 30 minutos', 'Verduras en almuerzo y cena', 'Tomar 2 litros de agua', 'Sin pantallas 1 h antes de dormir', 'Movilidad o estiramiento 10 min'];
  var DEFAULTS = { mode: 'deportivo', frequency: 'diaria', habits: [], set_by: 'paciente' };
  var TREND_METRICS = {
    energy: { label: 'Energía', chart: 'mood' },
    sleep: { label: 'Sueño', chart: 'sleep' },
    stress: { label: 'Estrés', chart: 'fatigue' },
    habits: { label: 'Hábitos (%)', chart: 'recovery' }
  };

  // ---------- Núcleo puro ----------
  function blank(v) { return v == null || v === ''; }
  function addDays(iso, n) { var d = new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000); return d.toISOString().slice(0, 10); }
  function dm(iso) { return iso.slice(8, 10) + '-' + iso.slice(5, 7); }
  function mondayOf(iso) { var k = (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; return addDays(iso, -k); }
  function periodOf(freq) { return freq === 'semanal' ? 'semana' : 'dia'; }
  function dateFor(freq, iso) { return freq === 'semanal' ? mondayOf(iso) : iso; }
  function keyOf(period, date) { return period + '|' + date; }
  function byPeriod(logs, freq) { var p = periodOf(freq); return (logs || []).filter(function (l) { return (l.period || 'dia') === p; }); }

  // Recorta, quita vacíos y repetidos (sin importar mayúsculas). Devuelve { habits, error }.
  function normalizeHabits(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (h) {
      var t = String(h == null ? '' : h).trim(), k = t.toLowerCase();
      if (t && !seen[k]) { seen[k] = true; out.push(t); }
    });
    var bad = out.filter(function (h) { return h.length < 2 || h.length > 40; })[0];
    if (bad) return { habits: out, error: 'Cada hábito debe tener entre 2 y 40 letras ("' + bad.slice(0, 20) + '").' };
    if (out.length > MAX_HABITS) return { habits: out, error: 'Máximo ' + MAX_HABITS + ' hábitos: pocos y claros se cumplen más.' };
    return { habits: out, error: null };
  }
  // Mismas reglas que set_log_settings: el deportivo siempre es diario.
  function normalizeSettings(s) {
    s = s || {};
    var mode = MODES[s.mode] ? s.mode : 'deportivo';
    return { mode: mode, frequency: mode === 'deportivo' ? 'diaria' : (FREQS[s.frequency] ? s.frequency : 'diaria'), habits: normalizeHabits(s.habits).habits, set_by: s.set_by || 'paciente' };
  }
  function validateSettings(s) {
    if (!MODES[s.mode]) return 'Elige el tipo de registro.';
    if (s.mode === 'comun' && !FREQS[s.frequency]) return 'Elige cada cuánto se registra.';
    return normalizeHabits(s.habits).error;
  }
  // Entrada de la hoja de vida al cambiar la configuración. Mantener en sincronía con set_log_settings (SQL).
  function settingsSummary(s, byName) {
    s = normalizeSettings(s);
    var title = 'Registro: ' + (s.mode === 'deportivo' ? 'deportivo diario' : s.frequency === 'semanal' ? 'general semanal' : 'general diario');
    var body = s.mode === 'deportivo' ? 'Sueño, fatiga, ánimo, dolor y carga de cada sesión.'
      : 'Energía, sueño y estrés. ' + (s.habits.length ? 'Hábitos: ' + s.habits.join(', ') + '.' : 'Sin hábitos definidos.');
    return { title: title, body: body + (byName ? ' Definido por ' + byName + '.' : '') };
  }

  // Valida un registro antes de guardarlo. habits: los del plan vigente.
  function validateLog(row, freq, habits) {
    var weekly = freq === 'semanal';
    var scale = function (v) { return !blank(v) && Number(v) >= 1 && Number(v) <= 10 && Math.round(v) === Number(v); };
    if (!scale(row.energy)) return 'Indica tu energía de 1 a 10.';
    if (blank(row.sleep_hours) || !(Number(row.sleep_hours) >= 0 && Number(row.sleep_hours) <= 16)) return weekly ? 'Indica cuántas horas dormiste en promedio por noche (0 a 16).' : 'Indica cuántas horas dormiste anoche (0 a 16).';
    if (!blank(row.sleep_quality) && !scale(row.sleep_quality)) return 'La calidad del sueño va de 1 a 10.';
    if (!scale(row.stress)) return 'Indica tu estrés de 1 a 10.';
    if (weekly && row.log_date !== mondayOf(row.log_date)) return 'El registro semanal se guarda en el lunes de la semana.';
    var max = weekly ? 7 : 1, h = row.habits || {}, plan = habits || [];
    for (var k in h) {
      if (plan.indexOf(k) < 0) return 'El hábito "' + k + '" no está en tu plan.';
      var v = h[k];
      if (!(v === Math.round(v) && v >= 0 && v <= max)) return weekly ? 'Los días de cada hábito van de 0 a 7.' : 'Marca cada hábito como hecho o no.';
    }
    return null;
  }

  // ¿Qué toca registrar hoy? Diario: hoy. Semanal: la semana en curso.
  function pending(settings, logs, today) {
    var f = settings.frequency, date = dateFor(f, today), p = periodOf(f);
    var has = byPeriod(logs, f).some(function (l) { return l.log_date === date; });
    return { due: !has, period: p, date: date, label: f === 'semanal' ? 'semana del ' + dm(date) : 'hoy' };
  }
  // Semana que se ofrece por defecto: lunes o martes, si falta la anterior y la actual está vacía, la anterior.
  function defaultWeek(today, logs) {
    var cur = mondayOf(today), prev = addDays(cur, -7), w = byPeriod(logs, 'semanal');
    var has = function (d) { return w.some(function (l) { return l.log_date === d; }); };
    var dow = (new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7;
    return dow <= 1 && !has(cur) && !has(prev) ? prev : cur;
  }
  // Constancia: diario, últimos 7 días; semanal, últimas 4 semanas (incluida la actual).
  function adherence(logs, freq, today) {
    var weekly = freq === 'semanal', n = weekly ? 4 : 7, set = {}, done = 0;
    byPeriod(logs, freq).forEach(function (l) { set[l.log_date] = true; });
    for (var i = 0; i < n; i++) if (set[weekly ? addDays(mondayOf(today), -7 * i) : addDays(today, -i)]) done++;
    return { done: done, expected: n, text: (weekly ? 'Últimas 4 semanas: ' : 'Últimos 7 días: ') + done + '/' + n + ' registros' };
  }
  // Cumplimiento de cada hábito en los últimos 28 días, sobre los registros que lo incluían.
  function habitStats(logs, habits, freq, today) {
    var weekly = freq === 'semanal', from = weekly ? addDays(mondayOf(today), -21) : addDays(today, -27);
    var win = byPeriod(logs, freq).filter(function (l) { return l.log_date >= from && l.log_date <= today; });
    return (habits || []).map(function (h) {
      var done = 0, possible = 0;
      win.forEach(function (l) { var v = (l.habits || {})[h]; if (v != null) { done += Number(v); possible += weekly ? 7 : 1; } });
      return { habit: h, done: done, possible: possible, pct: possible ? Math.round(done / possible * 100) : null };
    });
  }
  // % de hábitos cumplidos en un registro (para la tendencia). null si no tenía hábitos.
  function habitPct(row, freq) {
    var h = row.habits || {}, ks = Object.keys(h), max = freq === 'semanal' ? 7 : 1;
    if (!ks.length) return null;
    return Math.round(ks.reduce(function (a, k) { return a + Number(h[k]); }, 0) / (ks.length * max) * 100);
  }
  function trendPointsFrom(logs, freq, metric) {
    return byPeriod(logs, freq).map(function (l) {
      var v = metric === 'habits' ? habitPct(l, freq) : metric === 'sleep' ? l.sleep_hours : l[metric];
      return blank(v) ? null : { iso: l.log_date, value: Number(v) };
    }).filter(Boolean);
  }

  var core = { MODES: MODES, FREQS: FREQS, MAX_HABITS: MAX_HABITS, SUGGESTED: SUGGESTED, DEFAULTS: DEFAULTS, TREND_METRICS: TREND_METRICS,
    mondayOf: mondayOf, periodOf: periodOf, normalizeHabits: normalizeHabits, normalizeSettings: normalizeSettings, validateSettings: validateSettings,
    settingsSummary: settingsSummary, validateLog: validateLog, pending: pending, defaultWeek: defaultWeek, adherence: adherence,
    habitStats: habitStats, habitPct: habitPct, trendPointsFrom: trendPointsFrom };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { msg: '', saving: false, week: null, cfg: null, cfgMsg: '', cfgBusy: false, loading: false, fetched: false };
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var css = '.rc-hab{display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-top:1px dashed var(--line);font-size:13px}' +
    '.rc-hab select{border:1px solid var(--line);border-radius:8px;padding:4px 6px;font-family:inherit}.rc-err{font-size:12.5px;color:#b91c1c;margin-top:6px}' +
    '.rc-stats{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.6}.rc-bar{display:inline-block;height:6px;border-radius:3px;background:var(--green);vertical-align:middle;margin-right:6px}' +
    '.rc-opt{display:flex;gap:8px;align-items:flex-start;padding:7px 0;font-size:13px}.rc-opt small{display:block;color:var(--muted);font-size:11.5px;line-height:1.4}' +
    '.rc-box{margin-top:10px;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff}.rc-box textarea{width:100%;min-height:96px;border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:13px}' +
    '.rc-line{font-size:12.5px;color:var(--muted);display:flex;gap:8px;align-items:center;flex-wrap:wrap}';

  function ensure() {
    if (document.getElementById('registro-comun-css') == null) { var s = document.createElement('style'); s.id = 'registro-comun-css'; s.textContent = css; document.head.appendChild(s); }
    if (!state.logSettings) state.logSettings = Object.assign({}, DEFAULTS);
    if (!state.wellnessLogs) state.wellnessLogs = isDemoMode ? demoLogs() : {};
    if (!state.journal) state.journal = [];
    if (!isDemoMode && currentPatientId && !ui.fetched && !ui.loading) load();
  }
  function settings() { ensure(); return normalizeSettings(state.logSettings); }
  function logsList() { var m = state.wellnessLogs || {}; return Object.keys(m).map(function (k) { return m[k]; }); }
  function isComun() { return !!state && settings().mode === 'comun'; }

  function demoLogs() {
    var t = todayISO(), out = {}, hab = SUGGESTED.slice(0, 3), seed = 7;
    var rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (var k = 41; k >= 1; k--) {
      var d = addDaysISO(t, -k), hd = {}; hab.forEach(function (h, i) { hd[h] = rnd() > (i === 2 ? 0.6 : 0.3) ? 1 : 0; });
      out[keyOf('dia', d)] = { period: 'dia', log_date: d, energy: k <= 3 ? 4 : 6 + Math.round(rnd() * 2), sleep_hours: Math.round((k <= 3 ? 6.2 : 7 + (rnd() - 0.5)) * 10) / 10, sleep_quality: 6 + Math.round(rnd() * 2), stress: k <= 3 ? 7 : 4 + Math.round(rnd() * 2), habits: hd, notes: null };
    }
    for (var w = 6; w >= 1; w--) {
      var m = addDaysISO(mondayOf(t), -7 * w), hw = {}; hab.forEach(function (h, i) { hw[h] = Math.min(7, 3 + Math.round(rnd() * 3) - (i === 2 ? 2 : 0)); });
      out[keyOf('semana', m)] = { period: 'semana', log_date: m, energy: 6 + Math.round(rnd() * 2), sleep_hours: Math.round((6.8 + rnd() * 0.6) * 10) / 10, sleep_quality: 6 + Math.round(rnd()), stress: 4 + Math.round(rnd() * 2), habits: hw, notes: null };
    }
    return out;
  }

  async function load() {
    ui.loading = true;
    try {
      var r = await Promise.all([supabaseClient.from('log_settings').select('*').eq('patient_id', currentPatientId).maybeSingle(),
        supabaseClient.from('wellness_logs').select('*').eq('patient_id', currentPatientId).gte('log_date', addDaysISO(todayISO(), -120))]);
      if (r[0].error || r[1].error) console.warn('registro general no disponible (¿migración pendiente?)', (r[0].error || r[1].error).message);
      else {
        if (r[0].data) state.logSettings = normalizeSettings(r[0].data);
        var map = {}; (r[1].data || []).forEach(function (l) { map[keyOf(l.period, l.log_date)] = l; });
        state.wellnessLogs = map;
      }
    } catch (e) { console.warn('registro general', e); }
    ui.loading = false; ui.fetched = true; saveState(); render();
  }

  function slider(id, label, hint, val) {
    return '<div class="pillar-row"><div class="pillar-name">' + label + '<div style="font-size:11px;color:var(--muted);font-weight:400;">' + hint + '</div></div>' +
      '<div class="pillar-slider-wrap"><input type="range" min="1" max="10" step="1" value="' + val + '" id="rc_' + id + '" oninput="document.getElementById(\'rc_v_' + id + '\').textContent=this.value">' +
      '<span class="pillar-val" id="rc_v_' + id + '">' + val + '</span></div></div>';
  }
  function statsHTML(s) {
    var logs = logsList(), h = '<div class="rc-stats">' + E(adherence(logs, s.frequency, todayISO()).text) + '.';
    var st = habitStats(logs, s.habits, s.frequency, todayISO()).filter(function (x) { return x.pct != null; });
    if (st.length) h += '<br>Hábitos, últimas 4 semanas (sobre tus registros):' + st.map(function (x) {
      return '<div><span class="rc-bar" style="width:' + Math.max(4, x.pct * 0.8) + 'px"></span>' + E(x.habit) + ': ' + x.pct + ' % (' + x.done + '/' + x.possible + (s.frequency === 'semanal' ? ' días' : '') + ')</div>';
    }).join('');
    return h + '</div>';
  }
  function logCard(s) {
    var weekly = s.frequency === 'semanal', t = todayISO(), logs = logsList();
    var date = weekly ? (ui.week || defaultWeek(t, logs)) : t, ex = state.wellnessLogs[keyOf(periodOf(s.frequency), date)] || null;
    var v = function (k, d) { return ex && !blank(ex[k]) ? ex[k] : d; };
    var h = '<div class="card" style="margin-bottom:16px;"><h3>' + (weekly ? 'Registro de la semana' : 'Registro de hoy') + '</h3>';
    h += '<div class="card-sub">' + (weekly ? 'Una vez por semana, menos de un minuto: piensa en la semana completa.' : 'Menos de 30 segundos.') + ' Tu equipo lo ve solo si le diste el permiso "Semáforo y registro".' + (ex ? ' <strong>Ya registrado: puedes editarlo.</strong>' : '') + '</div>';
    if (weekly) {
      var cur = mondayOf(t), prev = addDaysISO(cur, -7);
      h += '<div class="pillar-row"><div class="pillar-name">Semana</div><div class="pillar-slider-wrap"><select id="rc_week" onchange="SizigiaRegistro.setWeek(this.value)" style="padding:6px 8px;border:1px solid var(--line);border-radius:8px;">' +
        [[cur, 'Esta semana (desde el lunes ' + fmtDate(cur) + ')'], [prev, 'Semana pasada (desde el lunes ' + fmtDate(prev) + ')']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === date ? ' selected' : '') + '>' + E(o[1]) + '</option>'; }).join('') + '</select></div></div>';
    }
    h += slider('energy', weekly ? 'Energía de la semana' : 'Energía', '1 = sin energía · 10 = mucha energía', v('energy', 6));
    h += '<div class="pillar-row"><div class="pillar-name">' + (weekly ? 'Horas de sueño por noche' : 'Horas de sueño anoche') + (weekly ? '<div style="font-size:11px;color:var(--muted);font-weight:400;">promedio aproximado</div>' : '') + '</div><div class="pillar-slider-wrap"><input type="number" id="rc_sleep_hours" min="0" max="16" step="0.5" value="' + v('sleep_hours', 7) + '" style="width:80px;padding:6px 8px;border:1px solid var(--line);border-radius:8px;"></div></div>';
    h += slider('sleep_quality', 'Calidad del sueño', '1 = muy mala · 10 = excelente', v('sleep_quality', 6));
    h += slider('stress', weekly ? 'Estrés de la semana' : 'Estrés', '1 = tranquilo · 10 = muy estresado', v('stress', 4));
    if (s.habits.length) {
      h += '<div style="margin-top:8px;font-size:13px;font-weight:600">' + (weekly ? '¿Cuántos días cumpliste cada hábito?' : 'Hábitos de hoy') + '</div>';
      s.habits.forEach(function (hb, i) {
        var cur = ex && ex.habits && ex.habits[hb] != null ? Number(ex.habits[hb]) : 0;
        h += '<label class="rc-hab"><span>' + E(hb) + '</span>' + (weekly
          ? '<select class="rc-habit" data-i="' + i + '">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + n + (n === 1 ? ' día' : ' días') + '</option>'; }).join('') + '</select>'
          : '<input type="checkbox" class="rc-habit" data-i="' + i + '"' + (cur ? ' checked' : '') + '>') + '</label>';
      });
    } else h += '<div class="tc-note">Sin hábitos definidos. Agrégalos en "Configurar mi registro" (tú o tu coach).</div>';
    h += '<textarea class="checkin-note" id="rc_notes" placeholder="Algo que tu equipo deba saber (opcional)">' + E(v('notes', '')) + '</textarea>';
    if (ui.msg) h += '<div class="rc-err">' + E(ui.msg) + '</div>';
    h += '<div class="ring-detail-actions"><button class="btn small primary"' + (ui.saving ? ' disabled' : '') + ' onclick="SizigiaRegistro.save()">' + (ex ? 'Guardar cambios' : 'Guardar registro') + '</button></div>';
    return h + statsHTML(s) + configHTML(s) + '</div>';
  }

  function whoSet(s) { return s.set_by === 'profesional' ? ' · definido por tu coach o profesional' : s.set_by === 'admin' ? ' · definido por el equipo de Sizigia Lab' : ''; }
  function configHTML(s) {
    var h = '<div class="rc-line" style="margin-top:12px">Tu registro: <b>' + E(MODES[s.mode].toLowerCase() + ', ' + FREQS[s.frequency].toLowerCase()) + '</b>' + E(whoSet(s)) +
      (ui.cfg ? '' : ' <button class="btn small" onclick="SizigiaRegistro.openConfig(true)">Configurar mi registro</button>') + '</div>';
    if (!ui.cfg) return h;
    var c = ui.cfg;
    h += '<div class="rc-box"><h4 style="margin:0 0 6px">Configurar mi registro</h4>';
    if (s.set_by === 'profesional') h += '<div class="tc-note" style="margin-bottom:6px">Tu coach o profesional dejó esta configuración. Puedes cambiarla; el cambio queda en tu hoja de vida.</div>';
    h += '<label class="rc-opt"><input type="radio" name="rc_mode" value="deportivo"' + (c.mode === 'deportivo' ? ' checked' : '') + ' onchange="SizigiaRegistro.setCfg(\'mode\',this.value)"><span><b>Deportivo, cada día</b><small>Sueño, fatiga, ánimo, dolor y, si entrenaste, esfuerzo y minutos de la sesión. Para quien entrena con carga.</small></span></label>';
    h += '<label class="rc-opt"><input type="radio" name="rc_mode" value="comun"' + (c.mode === 'comun' ? ' checked' : '') + ' onchange="SizigiaRegistro.setCfg(\'mode\',this.value)"><span><b>General</b><small>Energía, sueño, estrés y tus hábitos. Sin datos de entrenamiento.</small></span></label>';
    if (c.mode === 'comun') {
      h += '<div style="font-size:13px;font-weight:600;margin-top:6px">¿Cada cuánto?</div><div class="p-row">' + Object.keys(FREQS).map(function (k) {
        return '<label style="font-size:13px"><input type="radio" name="rc_freq" value="' + k + '"' + (c.frequency === k ? ' checked' : '') + ' onchange="SizigiaRegistro.setCfg(\'frequency\',this.value)"> ' + FREQS[k] + '</label>';
      }).join('') + '</div>';
      h += '<div style="font-size:13px;font-weight:600;margin-top:6px">Hábitos (uno por línea, máximo ' + MAX_HABITS + ')</div><textarea id="rc_habits">' + E(c.habits.join('\n')) + '</textarea>';
      var sug = SUGGESTED.filter(function (x) { return c.habits.map(function (y) { return y.toLowerCase(); }).indexOf(x.toLowerCase()) < 0; });
      if (sug.length) h += '<div class="p-chips">' + sug.map(function (x) { return '<button type="button" class="p-chip" onclick="SizigiaRegistro.addHabit(\'' + E(x) + '\')">+ ' + E(x) + '</button>'; }).join('') + '</div>';
    }
    if (ui.cfgMsg) h += '<div class="rc-err">' + E(ui.cfgMsg) + '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn small primary"' + (ui.cfgBusy ? ' disabled' : '') + ' onclick="SizigiaRegistro.saveConfig()">' + (ui.cfgBusy ? 'Guardando…' : 'Guardar configuración') + '</button><button class="btn small" onclick="SizigiaRegistro.openConfig(false)">Cancelar</button></div>';
    return h + '</div>';
  }

  // Hook de rueda_final.html: en modo deportivo muestra la tarjeta de siempre (athleteCard) más la configuración.
  function card(athleteCard) {
    var s = settings();
    if (s.mode === 'comun') return logCard(s);
    return (typeof athleteCard === 'function' ? athleteCard() : '') + '<div class="card" style="margin-bottom:16px;">' + configHTML(s) +
      (ui.cfg ? '' : '<div class="tc-note">¿No entrenas con carga? El registro general pide solo energía, sueño, estrés y hábitos, cada día o una vez por semana.</div>') + '</div>';
  }
  function semaforo() { var s = settings(); return computeSemaforoComun(logsList(), s.frequency); }
  function trendPoints(metric) { return trendPointsFrom(logsList(), settings().frequency, metric); }

  // ---------- Acciones ----------
  function readHabitsDraft() { var el = document.getElementById('rc_habits'); if (el && ui.cfg) ui.cfg.habits = el.value.split('\n'); }
  function openConfig(on) {
    var s = settings();
    ui.cfgMsg = '';
    ui.cfg = on ? { mode: s.mode, frequency: s.frequency, habits: s.habits.length ? s.habits.slice() : SUGGESTED.slice(0, 3) } : null;
    render();
  }
  function setCfg(k, v) { readHabitsDraft(); ui.cfg[k] = v; render(); }
  function addHabit(x) { readHabitsDraft(); ui.cfg.habits = normalizeHabits(ui.cfg.habits).habits.concat([x]); render(); }
  async function saveConfig() {
    readHabitsDraft();
    var c = ui.cfg, err = validateSettings(c);
    if (err) { ui.cfgMsg = err; return render(); }
    var next = normalizeSettings(c), prev = settings();
    next.set_by = 'paciente';
    if (prev.mode === next.mode && prev.frequency === next.frequency && prev.habits.join('\n') === next.habits.join('\n')) { ui.cfg = null; return render(); }
    ui.cfgBusy = true; ui.cfgMsg = ''; render();
    if (!isDemoMode && currentPatientId) {
      var r = await supabaseClient.rpc('set_log_settings', { p_patient: null, p_mode: next.mode, p_frequency: next.frequency, p_habits: next.habits });
      if (r.error) { console.warn('set_log_settings', r.error); ui.cfgBusy = false; ui.cfgMsg = 'No se pudo guardar la configuración. Reintenta en un momento.'; return render(); }
      var jr = await supabaseClient.from('journal_entries').select('*').eq('patient_id', currentPatientId).order('entry_date', { ascending: false });
      if (!jr.error) state.journal = jr.data || [];
    } else {
      var sm = settingsSummary(next);
      state.journal.unshift({ id: 'loc-' + Math.random().toString(36).slice(2, 10), entry_date: todayISO(), kind: 'plan', title: sm.title, body: sm.body, author_kind: 'paciente', scope: 'bitacora' });
    }
    state.logSettings = next; ui.cfg = null; ui.cfgBusy = false; ui.week = null; ui.msg = '';
    saveState(); render();
  }
  async function save() {
    var s = settings(), weekly = s.frequency === 'semanal', t = todayISO();
    var num = function (id) { var el = document.getElementById(id); return el && el.value !== '' ? Number(el.value) : null; };
    var habits = {};
    Array.prototype.forEach.call(document.querySelectorAll('.rc-habit'), function (el) { var hb = s.habits[Number(el.getAttribute('data-i'))]; if (hb != null) habits[hb] = weekly ? Number(el.value) : (el.checked ? 1 : 0); });
    var wk = document.getElementById('rc_week');
    var row = { period: periodOf(s.frequency), log_date: weekly ? mondayOf(wk ? wk.value : t) : t, energy: num('rc_energy'), sleep_hours: num('rc_sleep_hours'),
      sleep_quality: num('rc_sleep_quality'), stress: num('rc_stress'), habits: habits, notes: ((document.getElementById('rc_notes') || {}).value || '').trim() || null };
    var err = validateLog(row, s.frequency, s.habits);
    if (err) { ui.msg = err; return render(); }
    ui.msg = '';
    if (!isDemoMode && currentPatientId) {
      ui.saving = true;
      var r = await supabaseClient.from('wellness_logs').upsert(Object.assign({ patient_id: currentPatientId, updated_at: new Date().toISOString() }, row), { onConflict: 'patient_id,period,log_date' });
      ui.saving = false;
      if (r.error) { console.warn('wellness_logs', r.error); ui.msg = 'No se pudo guardar el registro. Reintenta en un momento; si persiste, avisa a tu equipo.'; return render(); }
    }
    state.wellnessLogs[keyOf(row.period, row.log_date)] = row;
    saveState(); render();
  }

  root.SizigiaRegistro = Object.assign({}, core, {
    card: card, isComun: isComun, semaforo: semaforo, trendPoints: trendPoints, settings: settings,
    openConfig: openConfig, setCfg: setCfg, addHabit: addHabit, saveConfig: saveConfig, save: save,
    setWeek: function (w) { ui.week = w; ui.msg = ''; render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
