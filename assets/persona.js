// Pantalla de la persona: semáforo explicado, tendencias, ciclo, perfil y hoja de vida (bitácora).
// Si la persona usa el registro general, el semáforo y las tendencias salen de registro-comun.js (SizigiaRegistro).
// Usa los globals de rueda_final.html (state, athleteLogs, supabaseClient, currentPatientId, isDemoMode, render, saveState,
// escapeHtml, todayISO, addDaysISO, daysBetween, fmtDate, sessionLoad) y los módulos semaforo.js y trend-chart.js.
(function (root) {
  'use strict';
  var KINDS = { nota: 'Nota', consulta: 'Consulta', examen: 'Examen', lesion: 'Lesión', plan: 'Plan', hito: 'Hito', objetivo: 'Objetivo', suplemento: 'Suplemento', medicamento: 'Medicamento' };
  var ADD_KINDS = ['nota', 'objetivo', 'lesion', 'suplemento', 'medicamento', 'hito'];
  var SYMPTOMS = ['Cólicos', 'Dolor de cabeza', 'Hinchazón', 'Ánimo bajo', 'Fatiga', 'Antojos', 'Sensibilidad mamaria'];
  var METRICS = {
    sleep:   { label: 'Sueño',  get: function (l) { return l.sleep_hours; } },
    fatigue: { label: 'Fatiga', get: function (l) { return l.fatigue; } },
    mood:    { label: 'Ánimo',  get: function (l) { return l.mood; } },
    pain:    { label: 'Dolor',  get: function (l) { return l.pain_level; } },
    load:    { label: 'Carga',  get: function (l) { return typeof sessionLoad === 'function' ? sessionLoad(l) : null; } }
  };
  var ui = { metric: 'sleep', filter: 'todos', msg: '', cycleMsg: '', profMsg: '' };
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };

  var css = '.tc-tabs{display:flex;gap:6px;margin:8px 0}.tc-tab{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 11px;font-size:14px;cursor:pointer;font-family:inherit}.tc-tab.on{background:var(--ink);color:#fff;border-color:var(--ink)}' +
    'svg.tc{display:block;max-width:560px}.tc-note{font-size:13px;color:var(--muted);margin-top:6px;line-height:1.45}.tc-empty{font-size:15px;color:var(--muted);padding:14px 0}' +
    '.sem-why{margin-top:10px;font-size:14.5px}.sem-why summary{cursor:pointer;color:var(--muted)}.sem-why-text{margin:6px 0;line-height:1.5}.sem-check{margin:3px 0}.sem-check.warn,.sem-check.alert{font-weight:600}.sem-check.nodata{color:var(--muted)}' +
    '.p-sem{display:flex;gap:14px;align-items:flex-start}.p-dot{width:30px;height:30px;border-radius:50%;flex:none;margin-top:2px}' +
    '.p-pill{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--gray-bg);color:var(--ink)}' +
    '.p-chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.p-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 11px;font-size:14px;cursor:pointer;font-family:inherit}.p-chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}' +
    '.p-tl{border-left:2px solid var(--line);margin:8px 0 0 6px;padding-left:16px}.p-item{position:relative;margin:0 0 16px}.p-item:before{content:"";position:absolute;left:-23px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--ink)}' +
    '.p-item .meta{font-size:13px;color:var(--muted);margin-bottom:2px}.p-item .ttl{font-weight:600;font-size:16px}.p-item .bd{font-size:15px;margin-top:3px;white-space:pre-wrap;line-height:1.5}' +
    '.p-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}.p-row input[type=text],.p-row input[type=date],.p-row select,.p-row textarea{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font-family:inherit;font-size:15px}.p-row textarea{width:100%;min-height:60px}';
  function ensure() {
    if (document.getElementById('persona-css') == null) { var s = document.createElement('style'); s.id = 'persona-css'; s.textContent = css; document.head.appendChild(s); }
    if (!state.profile) state.profile = { sex: isDemoMode ? 'femenino' : null, tracksCycle: !!isDemoMode };
    if (!state.cycleLogs) state.cycleLogs = isDemoMode ? demoCycle() : {};
    if (!state.journal) state.journal = isDemoMode ? demoJournal() : [];
  }
  function uid() { return 'loc-' + Math.random().toString(36).slice(2, 10); }
  function demoCycle() {
    var out = {}, t = todayISO(), starts = [-46, -18];
    starts.forEach(function (st) { for (var k = 0; k < 5; k++) { var iso = addDaysISO(t, st + k); out[iso] = { log_date: iso, bleeding: true, flow: k < 2 ? 3 : k < 4 ? 2 : 1, cycle_day: k + 1, symptoms: k === 0 ? ['Cólicos', 'Fatiga'] : [] }; } });
    return out;
  }
  function demoJournal() {
    var t = todayISO();
    return [
      { id: uid(), entry_date: addDaysISO(t, -3), kind: 'plan', title: 'Ajuste de carga por 2 semanas', body: 'Bajar volumen 20 % mientras mejora el sueño.', author_kind: 'profesional' },
      { id: uid(), entry_date: addDaysISO(t, -12), kind: 'lesion', title: 'Nueva lesión: Rodilla (lado derecho)', body: 'Molestia al aterrizar saltos (posible tendinopatía rotuliana). EVA inicial 5/10. Tratante: Kinesióloga del club', author_kind: 'paciente', scope: 'lesiones' },
      { id: uid(), entry_date: addDaysISO(t, -40), kind: 'objetivo', title: 'Llegar al torneo regional en forma', body: 'Foco: sueño y recuperación entre sesiones.', author_kind: 'paciente' }
    ];
  }

  // ---------- Semáforo explicado ----------
  function semaforoResult() {
    return comun() ? root.SizigiaRegistro.semaforo() : computeSemaforo(Object.keys(athleteLogs()).map(function (k) { return athleteLogs()[k]; }));
  }
  function semaforoCard() {
    ensure();
    if (typeof computeSemaforo !== 'function') return '';
    var r = semaforoResult();
    var col = { verde: '#55704F', amarillo: '#B8862B', rojo: '#A13D2D', gris: '#8a8578' }[r.level];
    var nm = { verde: 'Verde', amarillo: 'Amarillo', rojo: 'Rojo', gris: 'Gris' }[r.level];
    var h = '<div class="card" style="margin-bottom:16px;"><div class="p-sem"><span class="p-dot" style="background:' + col + '"></span><div style="flex:1">';
    h += '<h3 style="margin:0">Tu semáforo de hoy: ' + nm + '</h3><div class="card-sub" style="margin:2px 0 0">' + E({rojo:'Conviene revisar tu carga con tu médico antes de entrenar fuerte',amarillo:'Precaución: conversa con tu equipo si se mantiene',verde:'Sin alertas en lo que registraste',gris:'Sin datos recientes: completa tu registro para actualizarlo'}[r.level]) + '</div>';
    r.reasons.forEach(function (x) { h += '<div style="font-size:15px;margin:4px 0">' + E(x.text) + '</div>'; });
    h += semChecksHTML(r.checks || [], r.why || '', escapeHtml);
    h += '<div class="tc-note">Señal informativa calculada con lo que registras. No es un diagnóstico ni una recomendación médica automática.</div></div></div></div>';
    return h;
  }

  // ---------- Tendencias ----------
  // Registro general (assets/registro-comun.js): otro semáforo y otras métricas, mismo gráfico.
  function comun() { return !!(root.SizigiaRegistro && root.SizigiaRegistro.isComun()); }
  function metrics() { return comun() ? root.SizigiaRegistro.TREND_METRICS : METRICS; }
  function metricKey() { var m = metrics(); return m[ui.metric] ? ui.metric : Object.keys(m)[0]; }
  function trendPoints(m) {
    if (comun()) return root.SizigiaRegistro.trendPoints(m);
    var logs = athleteLogs(), out = [];
    Object.keys(logs).forEach(function (iso) { var v = METRICS[m].get(logs[iso]); if (v != null && v !== '') out.push({ iso: iso, value: Number(v) }); });
    return out;
  }
  function trendsCard() {
    var M = metrics(), cur = metricKey();
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Tendencias</h3><div class="card-sub">Eje ajustado a tus datos y franja con tu rango habitual.</div><div class="p-chips">';
    Object.keys(M).forEach(function (k) { h += '<button type="button" class="p-chip' + (k === cur ? ' on' : '') + '" onclick="SizigiaPersona.setMetric(\'' + k + '\')">' + M[k].label + '</button>'; });
    return h + '</div><div id="persona-trend"></div></div>';
  }
  function mountTrend() {
    var el = document.getElementById('persona-trend');
    if (!el || !root.SizigiaCharts) return;
    var k = metricKey(), weekly = comun() && root.SizigiaRegistro.settings().frequency === 'semanal';
    var chart = comun() ? root.SizigiaRegistro.TREND_METRICS[k].chart : k;
    root.SizigiaCharts.mount(el, trendPoints(k), { metric: chart, label: metrics()[k].label, today: todayISO(), days: weekly ? 60 : 14 });
  }

  // ---------- Perfil y ciclo ----------
  function profileCard() {
    var p = state.profile;
    if (p.sex) {
      if (p.sex !== 'femenino' && !p.tracksCycle) return '<div style="font-size:14px;margin:0 0 16px"><button type="button" class="btn small" onclick="SizigiaPersona.enableCycle()">Activar seguimiento de ciclo</button></div>';
      return '';
    }
    var h = '<div class="card" style="margin-bottom:16px;border-left:3px solid var(--gold);"><h3>Completa tu perfil</h3><div class="card-sub">Tu sexo ajusta las referencias clínicas y activa el seguimiento de ciclo cuando corresponde. Solo lo ve tu equipo autorizado.</div>';
    h += '<div class="p-row"><select id="pf_sex"><option value="">Selecciona…</option><option value="femenino">Femenino</option><option value="masculino">Masculino</option><option value="no_indica">Prefiero no indicar</option></select>';
    h += '<label style="font-size:14.5px"><input type="checkbox" id="pf_cycle"> Quiero llevar seguimiento de ciclo</label><button class="btn small primary" onclick="SizigiaPersona.saveProfile()">Guardar</button></div>';
    if (ui.profMsg) h += '<div class="daycard-msg" style="color:#b91c1c">' + E(ui.profMsg) + '</div>';
    return h + '</div>';
  }
  function periodStarts() {
    var days = Object.keys(state.cycleLogs).filter(function (d) { return state.cycleLogs[d].bleeding; }).sort(), out = [];
    days.forEach(function (d) { var prev = addDaysISO(d, -1); if (!(state.cycleLogs[prev] && state.cycleLogs[prev].bleeding)) out.push(d); });
    return out;
  }
  function cycleInfo() {
    var st = periodStarts(), t = todayISO();
    if (!st.length) return { day: null, avg: null, n: 0 };
    var last = st[st.length - 1], day = daysBetween(last, t) + 1;
    var gaps = []; for (var i = 1; i < st.length; i++) gaps.push(daysBetween(st[i - 1], st[i]));
    var avg = gaps.length ? Math.round(gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length) : null;
    return { day: day > 0 && day <= 90 ? day : null, avg: avg, n: gaps.length };
  }
  function cycleCard() {
    var p = state.profile;
    if (!(p.sex === 'femenino' || p.tracksCycle)) return '';
    var t = todayISO(), ex = state.cycleLogs[t] || null, info = cycleInfo();
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Ciclo menstrual</h3><div class="card-sub">Solo tú ves esto. Tu equipo lo ve únicamente si tú lo autorizas.</div>';
    h += '<div style="font-size:15px;margin:4px 0 8px">' + (info.day ? 'Día <b>' + info.day + '</b> del ciclo según tus registros' + (info.avg ? ' · ciclo habitual ~' + info.avg + ' días (' + info.n + ' ' + (info.n === 1 ? 'ciclo' : 'ciclos') + ')' : '') : 'Aún no hay registros de sangrado: cuando marques el primer día, calculamos tu ciclo.') + '</div>';
    h += '<div class="p-row"><label><input type="checkbox" id="cy_bleeding"' + (ex && ex.bleeding ? ' checked' : '') + '> Sangrado hoy</label>';
    h += '<select id="cy_flow"><option value="">Flujo…</option>' + ['Escaso', 'Moderado', 'Abundante'].map(function (n, i) { return '<option value="' + (i + 1) + '"' + (ex && ex.flow === i + 1 ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>';
    h += '<div class="p-chips">' + SYMPTOMS.map(function (s) { var on = ex && (ex.symptoms || []).indexOf(s) >= 0; return '<label class="p-chip' + (on ? ' on' : '') + '"><input type="checkbox" class="cy_sym" value="' + E(s) + '"' + (on ? ' checked' : '') + ' style="display:none" onchange="this.parentNode.classList.toggle(\'on\',this.checked)">' + E(s) + '</label>'; }).join('') + '</div>';
    h += '<button class="btn small primary" onclick="SizigiaPersona.saveCycle()">' + (ex ? 'Guardar cambios' : 'Guardar registro') + '</button>';
    if (ui.cycleMsg) h += ' <span style="font-size:14px;color:var(--muted)">' + E(ui.cycleMsg) + '</span>';
    return h + '</div>';
  }

  // ---------- Hoja de vida ----------
  function timeline() {
    var items = state.journal.map(function (j) { return { date: j.entry_date, kind: j.kind, title: j.title, body: j.body, who: j.author_kind }; });
    (state.sessions || []).forEach(function (s) { items.push({ date: s.date, kind: 'consulta', title: s.title || 'Consulta', body: s.summary || '', who: 'profesional' }); });
    items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    return items;
  }
  function bitacoraTab() {
    ensure();
    var all = timeline(), items = all.filter(function (i) { return ui.filter === 'todos' || i.kind === ui.filter; });
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Mi hoja de vida</h3><div class="card-sub">Todo lo que pasa con tu salud, en orden, desde el ' + fmtDate(state.patient.startDate) + '. Sin plazo: sigue mientras uses tu cuenta. ' + all.length + (all.length === 1 ? ' entrada.' : ' entradas.') + '</div></div>';
    h += '<div class="card" style="margin-bottom:16px;"><h3>Agregar a mi bitácora</h3><div class="p-row"><select id="jr_kind">' + ADD_KINDS.map(function (k) { return '<option value="' + k + '">' + KINDS[k] + '</option>'; }).join('') + '</select><input type="date" id="jr_date" value="' + todayISO() + '"><input type="text" id="jr_title" placeholder="Título" style="flex:1;min-width:160px"></div>';
    h += '<div class="p-row"><textarea id="jr_body" placeholder="Detalle (opcional)"></textarea></div><button class="btn small primary" onclick="SizigiaPersona.saveJournal()">Guardar</button>' + (ui.msg ? ' <span style="font-size:14px;color:#b91c1c">' + E(ui.msg) + '</span>' : '') + '</div>';
    h += '<div class="card"><div class="p-chips">' + ['todos'].concat(Object.keys(KINDS)).map(function (k) { return '<button type="button" class="p-chip' + (ui.filter === k ? ' on' : '') + '" onclick="SizigiaPersona.setFilter(\'' + k + '\')">' + (k === 'todos' ? 'Todo' : KINDS[k]) + '</button>'; }).join('') + '</div>';
    if (!items.length) return h + '<div class="tc-empty">Aún no hay entradas de este tipo.</div></div>';
    h += '<div class="p-tl">' + items.map(function (i) {
      return '<div class="p-item"><div class="meta"><span class="p-pill">' + E(KINDS[i.kind] || i.kind) + '</span> ' + fmtDate(i.date) + ' · ' + (i.who === 'paciente' ? 'Tú' : i.who === 'admin' ? 'Equipo Sizigia' : 'Tu equipo') + '</div><div class="ttl">' + E(i.title) + '</div>' + (i.body ? '<div class="bd">' + E(i.body) + '</div>' : '') + '</div>';
    }).join('') + '</div></div>';
    return h;
  }

  // ---------- Acciones ----------
  function done() { saveState(); render(); }
  async function saveProfile() {
    var sex = document.getElementById('pf_sex').value, cyc = document.getElementById('pf_cycle').checked;
    if (!sex) { ui.profMsg = 'Selecciona una opción (puede ser "Prefiero no indicar").'; return render(); }
    ui.profMsg = '';
    if (!isDemoMode && currentPatientId) {
      var r = await supabaseClient.rpc('set_my_profile', { p_sex: sex, p_tracks_cycle: cyc });
      if (r.error) { ui.profMsg = 'No se pudo guardar. Reintenta en un momento.'; return render(); }
    }
    state.profile = { sex: sex, tracksCycle: cyc || sex === 'femenino' };
    done();
  }
  async function enableCycle() {
    if (!isDemoMode && currentPatientId) { var r = await supabaseClient.rpc('set_my_profile', { p_sex: state.profile.sex, p_tracks_cycle: true }); if (r.error) return; }
    state.profile.tracksCycle = true; done();
  }
  // Guarda el ciclo de hoy sin tocar la pantalla (lo usa también el registro diario). Devuelve un error o null.
  async function saveCycleRow(input) {
    ensure();
    var t = todayISO(), bleeding = !!input.bleeding, flow = input.flow;
    var st = periodStarts(), prevBleed = state.cycleLogs[addDaysISO(t, -1)] && state.cycleLogs[addDaysISO(t, -1)].bleeding;
    var lastStart = st.filter(function (d) { return d < t; }).pop(), day = bleeding && !prevBleed ? 1 : (lastStart ? daysBetween(lastStart, t) + 1 : null);
    var row = { log_date: t, bleeding: bleeding, flow: bleeding && flow ? Number(flow) : null, cycle_day: day && day <= 90 ? day : null, symptoms: input.symptoms || [] };
    if (!isDemoMode && currentPatientId) {
      var r = await supabaseClient.from('cycle_logs').upsert(Object.assign({ patient_id: currentPatientId }, row), { onConflict: 'patient_id,log_date' });
      if (r.error) return 'No se pudo guardar el ciclo. Reintenta.';
    }
    state.cycleLogs[t] = row;
    return null;
  }
  async function saveCycle() {
    var syms = Array.prototype.map.call(document.querySelectorAll('.cy_sym:checked'), function (c) { return c.value; });
    ui.cycleMsg = '';
    var err = await saveCycleRow({ bleeding: document.getElementById('cy_bleeding').checked, flow: document.getElementById('cy_flow').value, symptoms: syms });
    if (err) { ui.cycleMsg = 'No se pudo guardar. Reintenta.'; return render(); }
    ui.cycleMsg = 'Guardado.'; done();
  }
  async function saveJournal() {
    var title = document.getElementById('jr_title').value.trim(), kind = document.getElementById('jr_kind').value, date = document.getElementById('jr_date').value || todayISO(), body = document.getElementById('jr_body').value.trim();
    if (!title) { ui.msg = 'Escribe un título.'; return render(); }
    ui.msg = '';
    var row = { id: uid(), entry_date: date, kind: kind, title: title, body: body || null, author_kind: 'paciente' };
    if (!isDemoMode && currentPatientId) {
      var r = await supabaseClient.from('journal_entries').insert({ patient_id: currentPatientId, entry_date: date, kind: kind, title: title, body: body || null, author_kind: 'paciente', scope: 'bitacora' }).select().single();
      if (r.error) { ui.msg = 'No se pudo guardar. Reintenta.'; return render(); }
      row = r.data;
    }
    state.journal.unshift(row); done();
  }

  root.SizigiaPersona = {
    semaforoCard: semaforoCard,
    restCards: function () { ensure(); return trendsCard() + profileCard() + cycleCard(); },
    bitacoraTab: bitacoraTab,
    afterRender: function () { if (state && state.ui && state.ui.tab === 'resumen') mountTrend(); if (state && state.ui && state.ui.tab === 'lesiones' && root.SizigiaLesiones) root.SizigiaLesiones.afterRender(); },
    setMetric: function (m) { ui.metric = m; render(); },
    setFilter: function (f) { ui.filter = f; render(); },
    saveProfile: saveProfile, enableCycle: enableCycle, saveCycle: saveCycle, saveJournal: saveJournal,
    // Para la pantalla Hoy y el registro diario (assets/hoy.js, assets/registro-diario.js).
    tracksCycle: function () { ensure(); return state.profile.sex === 'femenino' || !!state.profile.tracksCycle; },
    cycleToday: function () { ensure(); return state.cycleLogs[todayISO()] || null; },
    cycleDay: function () { ensure(); return cycleInfo().day || null; },
    symptoms: SYMPTOMS, saveCycleRow: saveCycleRow,
    semaforo: function () { ensure(); return semaforoResult(); },
    trendPoints: trendPoints, mountTrend: mountTrend,
    trendsCard: function () { ensure(); return trendsCard(); },
    profileCard: function () { ensure(); return profileCard(); },
    cycleCard: function () { ensure(); return cycleCard(); }
  };
})(window);
