// Nutrición: plan por comida (versiones con historial), adherencia diaria por comida y peso/composición.
// El plan se guarda solo por set_nutrition_plan (migración 20261027), que deja una entrada 'plan' en la hoja de vida;
// en demo la replica planJournal(). La adherencia no va a la bitácora. Peso y composición se leen de la pestaña Medidas
// (state.measurements, tabla measurements): no se duplican.
// Adherencia = cuánto se cumplió de lo registrado (cumplí 1, parcial 0,5, no 0). Lo no registrado no cuenta como
// incumplido: se muestra aparte como constancia. Informativo, sin veredicto.
// Núcleo puro exportado para Node (tests/nutricion.test.mjs). La pantalla usa los globals de rueda_final.html
// (state, supabaseClient, currentPatientId, isDemoMode, render, saveState, escapeHtml, todayISO, addDaysISO, fmtDate, setTab)
// y trend-chart.js.
(function (root) {
  'use strict';
  var STATUS = { 2: 'Cumplí', 1: 'Parcial', 0: 'No' };
  var MAX_MEALS = 8, BACK_DAYS = 7;
  var TEMPLATE = [
    { key: 'm1', name: 'Desayuno', time: '08:00', guide: '' },
    { key: 'm2', name: 'Almuerzo', time: '13:30', guide: '' },
    { key: 'm3', name: 'Once', time: '17:30', guide: '' },
    { key: 'm4', name: 'Cena', time: '20:30', guide: '' }
  ];
  var BODY = [['weight_kg', 'Peso', 'kg'], ['body_fat_pct', '% grasa', '%'], ['muscle_mass_kg', 'Masa muscular', 'kg']];

  // ---------- Núcleo puro ----------
  function blank(v) { return v == null || String(v).trim() === ''; }
  function dec(v, d) { return (Math.round(Number(v) * Math.pow(10, d)) / Math.pow(10, d)).toString().replace('.', ','); }
  function addDays(iso, n) { return new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
  function nextKey(meals) {
    var max = 0; meals.forEach(function (m) { var n = Number(String(m.key).replace(/^m/, '')); if (n > max) max = n; });
    return 'm' + (max + 1);
  }
  function validatePlan(meals) {
    if (!meals.length) return 'Agrega al menos una comida.';
    if (meals.length > MAX_MEALS) return 'El plan lleva hasta ' + MAX_MEALS + ' comidas.';
    var seen = {};
    for (var k = 0; k < meals.length; k++) {
      if (blank(meals[k].name)) return 'Ponle nombre a la comida ' + (k + 1) + '.';
      if (seen[meals[k].key]) return 'Hay comidas repetidas.';
      seen[meals[k].key] = true;
      if (!blank(meals[k].time) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(meals[k].time)) return 'La hora de ' + meals[k].name + ' no es válida.';
    }
    return null;
  }
  function cleanMeals(meals) {
    return meals.map(function (m) { return { key: m.key, name: String(m.name).trim(), time: blank(m.time) ? '' : m.time, guide: blank(m.guide) ? '' : String(m.guide).trim() }; });
  }

  // Misma regla que set_nutrition_plan() en SQL.
  function planJournal(prev, meals, notes) {
    var body = meals.length + (meals.length === 1 ? ' comida: ' : ' comidas: ') + meals.map(function (m) { return m.name; }).join(', ') + '.';
    if (!prev) return { title: 'Nuevo plan de alimentación', body: body };
    var ch = [], old = {};
    prev.meals.forEach(function (o) { old[o.key] = o; });
    meals.forEach(function (m) {
      var o = old[m.key];
      if (!o) ch.push('nueva: ' + m.name);
      else if (o.name !== m.name || (o.time || '') !== (m.time || '') || (o.guide || '') !== (m.guide || '')) ch.push(m.name);
    });
    prev.meals.forEach(function (o) { if (!meals.some(function (m) { return m.key === o.key; })) ch.push('sin: ' + o.name); });
    if ((prev.notes || '') !== (blank(notes) ? '' : String(notes).trim())) ch.push('indicaciones');
    return { title: 'Plan de alimentación actualizado', body: body + (ch.length ? ' Cambió: ' + ch.join(', ') + '.' : '') };
  }

  // Plan vigente en una fecha: el último creado con valid_from <= fecha. plans: cualquier orden.
  function planFor(plans, iso) {
    var best = null;
    plans.forEach(function (p) {
      if (p.valid_from <= iso && (!best || (p.created_at || '') > (best.created_at || ''))) best = p;
    });
    return best;
  }

  // logs: { 'YYYY-MM-DD': { meal_key: status } }. Ventana de `days` días que termina hoy.
  function adherence(plans, logs, today, days) {
    var out = { expected: 0, logged: 0, score: 0, byMeal: {}, daily: [] };
    for (var k = days - 1; k >= 0; k--) {
      var d = addDays(today, -k), p = planFor(plans, d);
      if (!p) continue;
      var day = (logs && logs[d]) || {}, dl = 0, ds = 0;
      p.meals.forEach(function (m) {
        var b = out.byMeal[m.name] || (out.byMeal[m.name] = { name: m.name, expected: 0, logged: 0, score: 0 });
        out.expected++; b.expected++;
        if (day[m.key] != null) { var s = Number(day[m.key]) / 2; out.logged++; out.score += s; b.logged++; b.score += s; dl++; ds += s; }
      });
      if (dl) out.daily.push({ iso: d, value: Math.round(ds / dl * 100) });
    }
    function pct(a, b) { return b ? Math.round(a / b * 100) : null; }
    return {
      days: days, expected: out.expected, logged: out.logged,
      pct: pct(out.score, out.logged), constancia: pct(out.logged, out.expected),
      byMeal: Object.keys(out.byMeal).map(function (n) { var b = out.byMeal[n]; return { name: n, logged: b.logged, expected: b.expected, pct: pct(b.score, b.logged) }; }),
      daily: out.daily
    };
  }
  // otra = true: en tercera persona, para la ficha del profesional.
  function adherenceText(a, otra) {
    if (a.expected === 0) return 'Sin plan en este período.';
    if (a.logged === 0) return 'Sin registros en los últimos ' + a.days + ' días.';
    var low = a.byMeal.filter(function (b) { return b.pct != null && b.logged >= 3; }).sort(function (x, y) { return x.pct - y.pct; })[0];
    var v = otra ? ['Cumplió', 'registró', 'Registró'] : ['Cumpliste', 'registraste', 'Registraste'];
    return v[0] + ' el ' + a.pct + ' % de lo que ' + v[1] + '. ' + v[2] + ' ' + a.logged + ' de ' + a.expected + ' comidas (' + a.constancia + ' %).' +
      (low && low.pct < a.pct ? ' La que más cuesta: ' + low.name + ' (' + low.pct + ' %).' : '');
  }

  // Peso y composición desde Medidas: último valor, cambio vs medición anterior y vs hace ~4 semanas.
  function bodySummary(measurements, today) {
    var isos = Object.keys(measurements || {}).sort();
    return BODY.map(function (f) {
      var pts = isos.filter(function (i) { return measurements[i][f[0]] != null && measurements[i][f[0]] !== ''; }).map(function (i) { return { iso: i, value: Number(measurements[i][f[0]]) }; });
      if (!pts.length) return { key: f[0], label: f[1], unit: f[2], last: null, points: [] };
      var last = pts[pts.length - 1], prev = pts.length > 1 ? pts[pts.length - 2] : null, cut = addDays(today, -28), month = null;
      pts.forEach(function (p) { if (p.iso <= cut) month = p; });
      return { key: f[0], label: f[1], unit: f[2], last: last, points: pts,
        dPrev: prev ? Math.round((last.value - prev.value) * 10) / 10 : null, prevIso: prev ? prev.iso : null,
        dMonth: month && month !== last ? Math.round((last.value - month.value) * 10) / 10 : null, monthIso: month ? month.iso : null };
    });
  }
  function signed(v, unit) { return (v > 0 ? '+' : v < 0 ? '−' : '') + dec(Math.abs(v), 1) + ' ' + unit; }

  var core = { STATUS: STATUS, TEMPLATE: TEMPLATE, MAX_MEALS: MAX_MEALS, BACK_DAYS: BACK_DAYS, nextKey: nextKey, validatePlan: validatePlan, cleanMeals: cleanMeals,
    planJournal: planJournal, planFor: planFor, adherence: adherence, adherenceText: adherenceText, bodySummary: bodySummary, signed: signed };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { msg: '', editing: false, draft: null, saving: false, loading: false, fetched: false, day: null, win: 7, logMsg: '' };
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var css = '.nu-meal{display:flex;gap:10px;padding:8px 0;border-top:1px solid var(--line)}.nu-meal:first-child{border-top:0}.nu-time{font-size:14px;color:var(--muted);min-width:42px;padding-top:2px}' +
    '.nu-meta{font-size:14.5px;color:var(--muted);line-height:1.5}.nu-err{font-size:14px;color:#b91c1c;margin-top:6px}.nu-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}' +
    '.nu-days{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}.nu-log{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line);flex-wrap:wrap}' +
    '.nu-st{display:flex;gap:4px}.nu-st button{border:1px solid var(--line);background:#fff;border-radius:999px;padding:4px 10px;font-size:14px;cursor:pointer;font-family:inherit}' +
    '.nu-st button.on.s2{background:#dcfce7;border-color:#16a34a;color:#166534}.nu-st button.on.s1{background:#fef3c7;border-color:#d97706;color:#92400e}.nu-st button.on.s0{background:#fee2e2;border-color:#dc2626;color:#991b1b}' +
    '.nu-row{display:grid;grid-template-columns:minmax(120px,1fr) 90px minmax(160px,2fr) auto;gap:6px;align-items:end;margin-top:6px}.nu-row input{width:100%;min-width:0}' +
    '@media(max-width:640px){.nu-row{grid-template-columns:1fr 90px auto}.nu-row .nu-wide{grid-column:1/-1;order:3}}' +
    '.nu-form label{font-size:14px;color:var(--muted);display:flex;flex-direction:column;gap:3px}.nu-bar{height:6px;background:var(--gray-bg);border-radius:3px;overflow:hidden;margin-top:3px}.nu-bar i{display:block;height:100%;background:#2f7d4f}';

  function lid() { return 'loc-' + Math.random().toString(36).slice(2, 10); }
  function ensure() {
    if (document.getElementById('nutricion-css') == null) { var s = document.createElement('style'); s.id = 'nutricion-css'; s.textContent = css; document.head.appendChild(s); }
    if (!state.nutritionPlans) state.nutritionPlans = isDemoMode ? demoPlans() : [];
    if (!state.mealLogs) state.mealLogs = isDemoMode ? demoLogs() : {};
    if (!state.journal) state.journal = [];
    if (!ui.day) ui.day = todayISO();
    if (!isDemoMode && currentPatientId && !ui.fetched && !ui.loading) load();
  }
  function demoPlans() {
    var t = todayISO();
    return [{ id: 'demo-plan', valid_from: addDaysISO(t, -30), created_at: addDaysISO(t, -30) + 'T12:00:00Z', author_kind: 'profesional', notes: 'Hidratación: 2 litros al día. Antes de entrenar, fruta y yogur.',
      meals: [
        { key: 'm1', name: 'Desayuno', time: '07:30', guide: 'Avena con leche o yogur, 1 fruta y frutos secos (1 puñado).' },
        { key: 'm2', name: 'Colación', time: '11:00', guide: '1 fruta + 1 yogur.' },
        { key: 'm3', name: 'Almuerzo', time: '13:30', guide: '½ plato de verduras, ¼ proteína (palma de la mano), ¼ arroz, papa o legumbres.' },
        { key: 'm4', name: 'Once', time: '17:30', guide: 'Pan integral con huevo o quesillo.' },
        { key: 'm5', name: 'Cena', time: '20:30', guide: 'Igual que el almuerzo, con menos carbohidrato si no entrenaste.' }
      ] }];
  }
  function demoLogs() {
    var t = todayISO(), out = {}, pat = ['22222', '22122', '2202', '22212', '21202', '2222', '22021', '22122', '2212', '22202', '22222', '21122', '2222'];
    pat.forEach(function (s, k) {
      var d = addDaysISO(t, -13 + k), day = {};
      s.split('').forEach(function (c, j) { day['m' + (j + 1)] = Number(c); });
      out[d] = day;
    });
    return out;
  }

  async function load() {
    ui.loading = true;
    try {
      var r = await supabaseClient.from('nutrition_plans').select('*').eq('patient_id', currentPatientId).order('created_at', { ascending: false });
      if (r.error) { ui.msg = 'Nutrición no disponible todavía.'; console.warn('nutrition_plans', r.error.message); }
      else {
        state.nutritionPlans = r.data || [];
        var g = await supabaseClient.from('meal_logs').select('log_date,meal_key,status').eq('patient_id', currentPatientId).gte('log_date', addDaysISO(todayISO(), -90));
        var map = {}; (g.data || []).forEach(function (x) { (map[x.log_date] = map[x.log_date] || {})[x.meal_key] = x.status; });
        state.mealLogs = map;
      }
    } catch (e) { console.warn('nutricion', e); }
    ui.loading = false; ui.fetched = true; saveState(); render();
  }
  async function reloadJournal() {
    var jr = await supabaseClient.from('journal_entries').select('*').eq('patient_id', currentPatientId).order('entry_date', { ascending: false });
    if (!jr.error) state.journal = jr.data || [];
  }
  function current() { return planFor(state.nutritionPlans, todayISO()) || state.nutritionPlans[0] || null; }
  function done() { saveState(); render(); }
  function opt(v, label, sel) { return '<option value="' + E(v) + '"' + (sel ? ' selected' : '') + '>' + E(label) + '</option>'; }
  function who(p) { return p.author_kind === 'paciente' ? 'ti' : p.author_kind === 'admin' ? 'el equipo Sizigia' : 'tu equipo'; }

  // ----- Editor del plan (borrador en ui.draft, sincronizado desde el DOM antes de cada re-render)
  function g(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function sync() {
    var d = ui.draft; if (!d || !document.getElementById('nu_notes')) return;
    d.notes = g('nu_notes');
    d.meals.forEach(function (m, k) { m.name = g('num_n' + k); m.time = g('num_t' + k); m.guide = g('num_g' + k); });
  }
  function editorHTML() {
    var d = ui.draft;
    var h = '<div class="nu-form" style="margin-top:10px"><div class="nu-meta">Una fila por comida. En "Qué comer" anota la guía de tu nutricionista (porciones, opciones).</div>';
    d.meals.forEach(function (m, k) {
      h += '<div class="nu-row"><label>Comida<input type="text" id="num_n' + k + '" value="' + E(m.name) + '" placeholder="Ej.: Desayuno"></label>' +
        '<label>Hora<input type="time" id="num_t' + k + '" value="' + E(m.time) + '"></label>' +
        '<label class="nu-wide">Qué comer<input type="text" id="num_g' + k + '" value="' + E(m.guide) + '" placeholder="Opcional"></label>' +
        '<button type="button" class="btn small" title="Quitar" onclick="SizigiaNutricion.removeMeal(' + k + ')">✕</button></div>';
    });
    if (d.meals.length < MAX_MEALS) h += '<div class="nu-actions"><button type="button" class="btn small" onclick="SizigiaNutricion.addMeal()">+ Agregar comida</button></div>';
    h += '<div class="p-row" style="margin-top:8px"><label style="flex:1">Indicaciones generales<textarea id="nu_notes" placeholder="Hidratación, suplementos, qué hacer antes de entrenar… (opcional)">' + E(d.notes) + '</textarea></label></div>';
    h += '<div class="nu-actions"><button class="btn small primary"' + (ui.saving ? ' disabled' : '') + ' onclick="SizigiaNutricion.savePlan()">' + (ui.saving ? 'Guardando…' : 'Guardar plan') + '</button><button class="btn small" onclick="SizigiaNutricion.cancel()">Cancelar</button></div>';
    if (ui.msg) h += '<div class="nu-err">' + E(ui.msg) + '</div>';
    return h + '</div>';
  }

  function planCard(p) {
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Mi plan de alimentación</h3>';
    if (ui.editing) return h + editorHTML() + '</div>';
    if (!p) {
      h += '<div class="card-sub">Todavía no tienes un plan. Puedes copiar el que te dio tu nutricionista o partir de una base de 4 comidas y ajustarla.</div>';
      return h + '<div class="nu-actions"><button class="btn small primary" onclick="SizigiaNutricion.edit()">Crear mi plan</button></div>' + (ui.msg ? '<div class="nu-err">' + E(ui.msg) + '</div>' : '') + '</div>';
    }
    h += '<div class="nu-meta">Vigente desde el ' + fmtDate(p.valid_from) + ' · escrito por ' + who(p) + (state.nutritionPlans.length > 1 ? ' · versión ' + state.nutritionPlans.length : '') + '</div>';
    h += '<div style="margin-top:6px">' + p.meals.map(function (m) {
      return '<div class="nu-meal"><div class="nu-time">' + E(m.time || '—') + '</div><div><b style="font-size:15.5px">' + E(m.name) + '</b>' + (m.guide ? '<div class="nu-meta">' + E(m.guide) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
    if (p.notes) h += '<div class="tc-note" style="white-space:pre-wrap">' + E(p.notes) + '</div>';
    return h + '<div class="nu-actions"><button class="btn small" onclick="SizigiaNutricion.edit()">Editar plan</button></div></div>';
  }

  function dayLabel(iso) {
    var t = todayISO();
    if (iso === t) return 'Hoy';
    if (iso === addDaysISO(t, -1)) return 'Ayer';
    return fmtDate(iso);
  }
  function logCard() {
    var day = ui.day, p = planFor(state.nutritionPlans, day) || current();
    var h = '<div class="card" style="margin-bottom:16px;"><h3>¿Cómo te fue?</h3><div class="card-sub">Marca cada comida. Puedes completar hasta ' + BACK_DAYS + ' días atrás.</div><div class="nu-days">';
    for (var k = 0; k <= BACK_DAYS; k++) {
      var d = addDaysISO(todayISO(), -k), n = Object.keys(state.mealLogs[d] || {}).length;
      h += '<button type="button" class="p-chip' + (d === day ? ' on' : '') + '" onclick="SizigiaNutricion.setDay(\'' + d + '\')">' + E(dayLabel(d)) + (n ? ' · ' + n : '') + '</button>';
    }
    h += '</div>';
    var logs = state.mealLogs[day] || {};
    p.meals.forEach(function (m) {
      var v = logs[m.key];
      h += '<div class="nu-log"><div><b style="font-size:15.5px">' + E(m.name) + '</b>' + (m.time ? ' <span class="nu-meta">' + E(m.time) + '</span>' : '') + '</div><div class="nu-st">' +
        [2, 1, 0].map(function (s) { return '<button type="button" class="s' + s + (v === s ? ' on' : '') + '" aria-pressed="' + (v === s) + '" onclick="SizigiaNutricion.mark(\'' + E(m.key) + '\',' + s + ')">' + STATUS[s] + '</button>'; }).join('') + '</div></div>';
    });
    if (ui.logMsg) h += '<div class="nu-err">' + E(ui.logMsg) + '</div>';
    return h + '</div>';
  }

  function adherenceCard() {
    var a = adherence(state.nutritionPlans, state.mealLogs, todayISO(), ui.win);
    var h = '<div class="card" style="margin-bottom:16px;"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h3 style="margin:0">Adherencia</h3><div class="p-chips" style="margin:0">' +
      [7, 28].map(function (w) { return '<button type="button" class="p-chip' + (ui.win === w ? ' on' : '') + '" onclick="SizigiaNutricion.setWin(' + w + ')">' + w + ' días</button>'; }).join('') + '</div></div>';
    h += '<div class="nu-meta" style="margin:6px 0">' + E(adherenceText(a)) + '</div>';
    if (a.logged) {
      h += a.byMeal.map(function (b) {
        return '<div style="font-size:14.5px;margin-top:6px"><div style="display:flex;justify-content:space-between"><span>' + E(b.name) + '</span><span class="nu-meta">' + (b.pct == null ? 'sin registro' : b.pct + ' % · ' + b.logged + '/' + b.expected) + '</span></div><div class="nu-bar"><i style="width:' + (b.pct || 0) + '%"></i></div></div>';
      }).join('');
      if (root.SizigiaCharts && a.daily.length >= 2) h += '<div style="max-width:560px;margin-top:10px">' + root.SizigiaCharts.build(a.daily, { metric: 'recovery', days: ui.win, today: todayISO(), label: 'Adherencia por día (% de lo registrado)' }) + '</div>';
    }
    return h + '<div class="tc-note">Cumplí cuenta 1, parcial ½ y no 0. Lo que no registras no cuenta como incumplido: aparece como comidas registradas.</div></div>';
  }

  function bodyCard() {
    var b = bodySummary(state.measurements, todayISO()), any = b.some(function (x) { return x.last; });
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Peso y composición</h3><div class="card-sub">Desde tus mediciones (pestaña Medidas).</div>';
    if (!any) return h + '<div class="tc-empty">Todavía no hay mediciones.</div><div class="nu-actions"><button class="btn small" onclick="setTab(\'medidas\')">Registrar medición</button></div></div>';
    h += '<div class="stat-chips">' + b.filter(function (x) { return x.last; }).map(function (x) {
      var sub = x.dMonth != null ? signed(x.dMonth, x.unit) + ' desde el ' + fmtDate(x.monthIso) : x.dPrev != null ? signed(x.dPrev, x.unit) + ' vs. medición anterior' : 'Primera medición';
      return '<div class="stat-chip"><div class="num">' + dec(x.last.value, 1) + ' <span style="font-size:14px;font-weight:600;color:var(--muted);">' + E(x.unit) + '</span></div><div class="lbl">' + E(x.label) + ' · ' + fmtDate(x.last.iso) + '</div><div style="font-size:12.5px;color:var(--muted);margin-top:2px;">' + E(sub) + '</div></div>';
    }).join('') + '</div>';
    var w = b[0];
    if (root.SizigiaCharts && w.points.length >= 2) h += '<div style="max-width:560px">' + root.SizigiaCharts.build(w.points, { metric: 'weight', days: 90, today: todayISO(), label: 'Peso, últimos 90 días' }) + '</div>';
    return h + '<div class="nu-actions"><button class="btn small" onclick="setTab(\'medidas\')">Registrar medición</button></div></div>';
  }

  function tab() {
    ensure();
    var p = current();
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Nutrición</h3><div class="card-sub">Tu plan por comida, cuánto lo cumples y cómo cambia tu cuerpo. Tu equipo lo ve solo si autorizas el permiso de nutrición.</div>';
    h += '<div class="tc-note">Registro informativo para conversar con tu nutricionista. No es una pauta clínica.</div></div>';
    if (ui.loading && !p) return h + '<div class="tc-empty">Cargando…</div>';
    h += planCard(p);
    if (p && !ui.editing) h += logCard() + adherenceCard();
    return h + bodyCard();
  }

  // ---------- Acciones ----------
  function edit() {
    var p = current();
    ui.draft = p ? { meals: p.meals.map(function (m) { return Object.assign({}, m); }), notes: p.notes || '' } : { meals: TEMPLATE.map(function (m) { return Object.assign({}, m); }), notes: '' };
    ui.editing = true; ui.msg = ''; render();
  }
  function cancel() { ui.editing = false; ui.draft = null; ui.msg = ''; render(); }
  function addMeal() { sync(); ui.draft.meals.push({ key: nextKey(ui.draft.meals), name: '', time: '', guide: '' }); render(); }
  function removeMeal(k) { sync(); ui.draft.meals.splice(k, 1); render(); }
  async function savePlan() {
    if (ui.saving) return;
    sync();
    var meals = cleanMeals(ui.draft.meals), notes = String(ui.draft.notes || '').trim(), err = validatePlan(meals);
    if (err) { ui.msg = err; return render(); }
    var prev = current();
    ui.saving = true; ui.msg = ''; render();
    try {
      if (isDemoMode || !currentPatientId) {
        var j = planJournal(prev, meals, notes);
        state.nutritionPlans.unshift({ id: lid(), valid_from: todayISO(), created_at: new Date().toISOString(), meals: meals, notes: notes || null, author_kind: 'paciente' });
        state.journal.unshift({ id: lid(), entry_date: todayISO(), kind: 'plan', title: j.title, body: j.body, author_kind: 'paciente', scope: 'nutricion' });
      } else {
        var r = await supabaseClient.rpc('set_nutrition_plan', { p_patient: currentPatientId, p_meals: meals, p_notes: notes });
        if (r.error) throw r.error;
        ui.fetched = false; await load(); await reloadJournal();
      }
      ui.editing = false; ui.draft = null;
    } catch (e) { console.warn('set_nutrition_plan', e); ui.msg = 'No se pudo guardar. Reintenta en un momento.'; }
    ui.saving = false; done();
  }
  // Tocar el mismo estado de nuevo lo borra.
  async function mark(key, status) {
    var day = ui.day, p = planFor(state.nutritionPlans, day) || current(), logs = state.mealLogs[day] || {}, unset = logs[key] === status;
    ui.logMsg = '';
    if (!isDemoMode && currentPatientId) {
      var q = supabaseClient.from('meal_logs');
      var r = unset ? await q.delete().eq('patient_id', currentPatientId).eq('log_date', day).eq('meal_key', key)
        : await q.upsert({ patient_id: currentPatientId, plan_id: p.id, log_date: day, meal_key: key, status: status, updated_at: new Date().toISOString() }, { onConflict: 'patient_id,log_date,meal_key' });
      if (r.error) { ui.logMsg = 'No se pudo guardar. Reintenta.'; return render(); }
    }
    if (unset) delete logs[key]; else logs[key] = status;
    if (Object.keys(logs).length) state.mealLogs[day] = logs; else delete state.mealLogs[day];
    done();
  }

  root.SizigiaNutricion = Object.assign({}, core, {
    tab: tab, edit: edit, cancel: cancel, addMeal: addMeal, removeMeal: removeMeal, savePlan: savePlan, mark: mark,
    setDay: function (d) { ui.day = d; ui.logMsg = ''; render(); },
    setWin: function (w) { ui.win = w; render(); }
  });
})(typeof window !== 'undefined' ? window : globalThis);
