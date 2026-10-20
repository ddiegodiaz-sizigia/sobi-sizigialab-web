// Lesiones y rehabilitación: historial por lesión (fecha, zona, EVA, tratante, estado, alta, notas) y dolor diario
// enlazado a cada lesión abierta. Cada cambio queda en la hoja de vida (journal_entries, kind 'lesion'): en Supabase lo
// hace el trigger injuries_to_journal (migración 20261022); en demo lo replica describeChange().
// Núcleo puro exportado para Node (tests/lesiones.test.mjs). La pantalla usa los globals de rueda_final.html
// (state, supabaseClient, currentPatientId, isDemoMode, render, saveState, escapeHtml, todayISO, addDaysISO,
// daysBetween, fmtDate, athleteLogs, PAIN_ZONES) y trend-chart.js.
(function (root) {
  'use strict';
  var STATUS = { activa: 'Activa', rehabilitacion: 'En rehabilitación', alta: 'Alta' };
  var SIDES = { izquierda: 'Izquierda', derecha: 'Derecha', bilateral: 'Bilateral', no_aplica: 'No aplica' };
  var FIELDS = [['zone', 'zona'], ['side', 'zona'], ['title', 'descripción'], ['onset_date', 'fecha de inicio'], ['eva_initial', 'EVA inicial'],
    ['treating', 'tratante'], ['discharge_date', 'fecha de alta'], ['notes', 'notas']];
  var ZONES_FALLBACK = ['Cuello', 'Hombro', 'Codo / antebrazo', 'Muñeca / mano', 'Espalda alta', 'Zona lumbar', 'Cadera / ingle', 'Muslo anterior', 'Isquiotibiales', 'Rodilla', 'Pantorrilla / tibia', 'Tobillo / pie', 'Otra'];

  // ---------- Núcleo puro ----------
  function blank(v) { return v == null || v === ''; }
  function dmy(iso) { return iso.slice(8, 10) + '-' + iso.slice(5, 7) + '-' + iso.slice(0, 4); }
  function injuryName(i) {
    var s = { izquierda: ' (lado izquierdo)', derecha: ' (lado derecho)', bilateral: ' (bilateral)' }[i.side] || '';
    return i.zone + s;
  }
  function isOpen(i) { return i.status !== 'alta'; }

  // Devuelve un mensaje de error o null. today: 'YYYY-MM-DD'.
  function validate(i, today) {
    if (blank(i.zone)) return 'Elige la zona.';
    if (blank(i.title) || !String(i.title).trim()) return 'Describe la lesión (por ejemplo: esguince, sobrecarga, tendinopatía).';
    if (blank(i.onset_date)) return 'Indica cuándo empezó.';
    if (today && i.onset_date > today) return 'La fecha de inicio no puede ser futura.';
    if (!blank(i.eva_initial) && !(Number(i.eva_initial) >= 0 && Number(i.eva_initial) <= 10)) return 'La EVA va de 0 a 10.';
    if (i.status === 'alta') {
      if (blank(i.discharge_date)) return 'Indica la fecha de alta.';
      if (i.discharge_date < i.onset_date) return 'El alta no puede ser anterior al inicio.';
      if (today && i.discharge_date > today) return 'La fecha de alta no puede ser futura.';
    }
    return null;
  }

  // Misma regla que el trigger SQL: entrada de bitácora para un alta/cambio, o null si no cambió nada relevante.
  function describeChange(prev, next) {
    var name = injuryName(next);
    if (!prev) {
      return { title: 'Nueva lesión: ' + name, body: next.title + (blank(next.eva_initial) ? '' : '. EVA inicial ' + next.eva_initial + '/10') + (blank(next.treating) ? '' : '. Tratante: ' + next.treating), date: next.onset_date };
    }
    if (prev.status !== next.status) {
      var t = next.status === 'alta' ? 'Alta: ' : prev.status === 'alta' ? 'Recaída: ' : next.status === 'rehabilitacion' ? 'En rehabilitación: ' : 'Lesión activa de nuevo: ';
      return { title: t + name, body: next.title + (next.status === 'alta' ? '. Alta el ' + dmy(next.discharge_date) : ''), date: null };
    }
    var changed = [];
    FIELDS.forEach(function (f) {
      var a = blank(prev[f[0]]) ? null : String(prev[f[0]]), b = blank(next[f[0]]) ? null : String(next[f[0]]);
      if (a !== b && changed.indexOf(f[1]) < 0) changed.push(f[1]);
    });
    if (!changed.length) return null;
    return { title: 'Lesión actualizada: ' + name, body: 'Cambió: ' + changed.join(', ') + '.' + (blank(next.notes) ? '' : ' Notas: ' + next.notes), date: null };
  }

  // Resumen informativo de una lesión con sus registros de dolor ([{log_date, eva}]).
  function summary(i, pain, today) {
    var logs = (pain || []).slice().sort(function (a, b) { return a.log_date < b.log_date ? -1 : 1; });
    var last = logs.length ? logs[logs.length - 1] : null;
    var end = i.status === 'alta' && i.discharge_date ? i.discharge_date : today;
    var days = Math.round((Date.parse(end + 'T00:00:00Z') - Date.parse(i.onset_date + 'T00:00:00Z')) / 86400000);
    var from = blank(i.eva_initial) ? (logs.length ? logs[0].eva : null) : Number(i.eva_initial);
    var now = last ? last.eva : from;
    var text;
    if (now == null) text = 'Sin registros de dolor todavía.';
    else if (!last) text = 'EVA inicial ' + from + '/10. Sin registros diarios' + (i.status === 'alta' ? '.' : ' todavía.');
    else if (from === now) text = 'Dolor ' + now + '/10 (último registro ' + dmy(last.log_date) + ').';
    else text = 'Dolor ' + (now < from ? 'bajó' : 'subió') + ' de ' + from + ' a ' + now + '/10' + (last ? ' (último registro ' + dmy(last.log_date) + ')' : '') + '.';
    return { days: days, evaFrom: from, evaNow: now, lastLog: last ? last.log_date : null, loggedToday: !!(last && last.log_date === today), text: text };
  }

  // Si el registro diario de hoy tiene dolor en la misma zona, se sugiere ese valor para la lesión.
  function suggestEva(i, dayLog) {
    if (!dayLog || blank(dayLog.pain_level) || blank(dayLog.pain_zone)) return null;
    return dayLog.pain_zone === i.zone ? Number(dayLog.pain_level) : null;
  }

  function sortInjuries(list) {
    return list.slice().sort(function (a, b) {
      if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
      return a.onset_date < b.onset_date ? 1 : a.onset_date > b.onset_date ? -1 : 0;
    });
  }

  var core = { STATUS: STATUS, SIDES: SIDES, injuryName: injuryName, isOpen: isOpen, validate: validate, describeChange: describeChange, summary: summary, suggestEva: suggestEva, sortInjuries: sortInjuries };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var ui = { msg: '', formOpen: false, editing: null, painMsg: {}, loading: false, fetched: false };
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };
  var css = '.les-card{border-left:3px solid var(--line)}.les-card.activa{border-left-color:#b3382c}.les-card.rehabilitacion{border-left-color:#c9921b}.les-card.alta{border-left-color:#2f7d4f}' +
    '.les-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;flex-wrap:wrap}.les-meta{font-size:12.5px;color:var(--muted);margin:2px 0 6px;line-height:1.5}' +
    '.les-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.les-pain{background:var(--gray-bg);border-radius:10px;padding:8px 10px;margin:8px 0}' +
    '.les-form label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:3px}.les-err{font-size:12px;color:#b91c1c;margin-top:6px}';

  function zones() { return typeof PAIN_ZONES !== 'undefined' ? PAIN_ZONES : ZONES_FALLBACK; }
  function lid() { return 'loc-' + Math.random().toString(36).slice(2, 10); }
  function ensure() {
    if (document.getElementById('lesiones-css') == null) { var s = document.createElement('style'); s.id = 'lesiones-css'; s.textContent = css; document.head.appendChild(s); }
    if (!state.injuries) state.injuries = isDemoMode ? demoInjuries() : [];
    if (!state.injuryPain) state.injuryPain = isDemoMode ? demoPain() : {};
    if (!state.journal) state.journal = [];
    if (!isDemoMode && currentPatientId && !ui.fetched && !ui.loading) load();
  }
  function demoInjuries() {
    var t = todayISO();
    return [
      { id: 'demo-rodilla', onset_date: addDaysISO(t, -12), zone: 'Rodilla', side: 'derecha', title: 'Molestia al aterrizar saltos (posible tendinopatía rotuliana)', eva_initial: 5, treating: 'Kinesióloga del club', status: 'rehabilitacion', discharge_date: null, notes: 'Excéntricos 3x/semana. Sin saltos por 2 semanas.' },
      { id: 'demo-tobillo', onset_date: addDaysISO(t, -150), zone: 'Tobillo / pie', side: 'izquierda', title: 'Esguince grado I', eva_initial: 6, treating: 'Dr. Acuña', status: 'alta', discharge_date: addDaysISO(t, -122), notes: null }
    ];
  }
  function demoPain() {
    var t = todayISO(), evas = [5, 5, 4, 5, 4, 4, 3, 4, 3, 3, 2], out = [];
    evas.forEach(function (v, k) { out.push({ log_date: addDaysISO(t, -11 + k), eva: v }); });
    return { 'demo-rodilla': out };
  }

  async function load() {
    ui.loading = true;
    try {
      var r = await supabaseClient.from('injuries').select('*').eq('patient_id', currentPatientId).order('onset_date', { ascending: false });
      if (r.error) { ui.msg = 'Lesiones no disponibles todavía.'; console.warn('injuries', r.error.message); }
      else {
        state.injuries = r.data || [];
        var p = await supabaseClient.from('injury_pain_logs').select('injury_id,log_date,eva').eq('patient_id', currentPatientId).gte('log_date', addDaysISO(todayISO(), -120));
        var map = {}; (p.data || []).forEach(function (x) { (map[x.injury_id] = map[x.injury_id] || []).push({ log_date: x.log_date, eva: x.eva }); });
        state.injuryPain = map;
      }
    } catch (e) { console.warn('injuries', e); }
    ui.loading = false; ui.fetched = true; saveState(); render();
  }
  // El trigger escribe en journal_entries: tras guardar, se relee la bitácora para mostrar la entrada nueva.
  async function reloadJournal() {
    var jr = await supabaseClient.from('journal_entries').select('*').eq('patient_id', currentPatientId).order('entry_date', { ascending: false });
    if (!jr.error) state.journal = jr.data || [];
  }
  function journalLocal(prev, next) {
    var c = describeChange(prev, next);
    if (c) state.journal.unshift({ id: lid(), entry_date: c.date || todayISO(), kind: 'lesion', title: c.title, body: c.body, author_kind: 'paciente', scope: 'lesiones' });
  }
  function find(id) { return state.injuries.filter(function (i) { return i.id === id; })[0]; }
  function done() { saveState(); render(); }

  function opt(v, label, sel) { return '<option value="' + E(v) + '"' + (sel ? ' selected' : '') + '>' + E(label) + '</option>'; }
  function formHTML(i) {
    var p = i ? 'le_' : 'ln_', v = i || { onset_date: todayISO(), status: 'activa' };
    var h = '<div class="les-form"><div class="p-row">';
    h += '<label>Desde<input type="date" id="' + p + 'onset" value="' + E(v.onset_date) + '" max="' + todayISO() + '"></label>';
    h += '<label>Zona<select id="' + p + 'zone">' + opt('', 'Elige…', !v.zone) + zones().map(function (z) { return opt(z, z, v.zone === z); }).join('') + '</select></label>';
    h += '<label>Lado<select id="' + p + 'side">' + opt('', '—', !v.side) + Object.keys(SIDES).map(function (k) { return opt(k, SIDES[k], v.side === k); }).join('') + '</select></label>';
    h += '<label>EVA inicial (0-10)<select id="' + p + 'eva">' + opt('', '—', blank(v.eva_initial)) + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return opt(n, n, !blank(v.eva_initial) && Number(v.eva_initial) === n); }).join('') + '</select></label></div>';
    h += '<div class="p-row"><label style="flex:1;min-width:200px">Qué pasó o diagnóstico<input type="text" id="' + p + 'title" value="' + E(v.title) + '" placeholder="Ej.: esguince de tobillo, sobrecarga lumbar"></label>';
    h += '<label style="min-width:160px">Tratante<input type="text" id="' + p + 'treating" value="' + E(v.treating) + '" placeholder="Kine, médico…"></label></div>';
    h += '<div class="p-row"><label style="flex:1">Notas<textarea id="' + p + 'notes" placeholder="Indicaciones, ejercicios, restricciones (opcional)">' + E(v.notes) + '</textarea></label></div>';
    return h + '</div>';
  }
  function readForm(p) {
    var g = function (k) { var el = document.getElementById(p + k); return el ? el.value.trim() : ''; };
    return { onset_date: g('onset'), zone: g('zone'), side: g('side') || null, title: g('title'), eva_initial: g('eva') === '' ? null : Number(g('eva')), treating: g('treating') || null, notes: g('notes') || null };
  }

  function painBox(i) {
    var today = todayISO(), logs = state.injuryPain[i.id] || [], ex = logs.filter(function (x) { return x.log_date === today; })[0];
    var sug = ex ? null : suggestEva(i, (typeof athleteLogs === 'function' ? athleteLogs() : {})[today]);
    var val = ex ? ex.eva : sug;
    var h = '<div class="les-pain"><div class="p-row" style="margin:0"><b style="font-size:13px">Dolor de hoy en esta lesión</b><select id="lp_' + E(i.id) + '">' + opt('', 'EVA…', val == null) + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (n) { return opt(n, n + '/10', val === n); }).join('') + '</select>';
    h += '<button class="btn small primary" onclick="SizigiaLesiones.savePain(\'' + E(i.id) + '\')">' + (ex ? 'Actualizar' : 'Guardar') + '</button>';
    if (ui.painMsg[i.id]) h += '<span style="font-size:12px;color:var(--muted)">' + E(ui.painMsg[i.id]) + '</span>';
    h += '</div>';
    if (sug != null) h += '<div class="tc-note">Sugerido desde tu registro diario de hoy (' + E(i.zone) + ', ' + sug + '/10). Confírmalo con Guardar.</div>';
    return h + '<div id="les-chart-' + E(i.id) + '"></div></div>';
  }

  function injuryCard(i) {
    var s = summary(i, state.injuryPain[i.id], todayISO());
    var h = '<div class="card les-card ' + E(i.status) + '" style="margin-bottom:12px;"><div class="les-head"><div><h3 style="margin:0">' + E(injuryName(i)) + '</h3>';
    h += '<div class="les-meta">' + E(i.title) + '</div></div><span class="p-pill">' + E(STATUS[i.status]) + '</span></div>';
    h += '<div class="les-meta">Desde el ' + fmtDate(i.onset_date) + (i.status === 'alta' ? ' · alta el ' + fmtDate(i.discharge_date) + ' (' + s.days + ' días)' : ' · hace ' + s.days + (s.days === 1 ? ' día' : ' días')) +
      (i.treating ? ' · Tratante: ' + E(i.treating) : '') + '<br>' + E(s.text) + '</div>';
    if (i.notes) h += '<div style="font-size:13px;white-space:pre-wrap;line-height:1.5">' + E(i.notes) + '</div>';
    if (ui.editing === i.id) {
      h += '<div style="margin-top:10px">' + formHTML(i) + '<div class="les-actions"><button class="btn small primary" onclick="SizigiaLesiones.saveEdit(\'' + E(i.id) + '\')">Guardar cambios</button><button class="btn small" onclick="SizigiaLesiones.edit(null)">Cancelar</button></div>';
      if (ui.msg) h += '<div class="les-err">' + E(ui.msg) + '</div>';
      return h + '</div></div>';
    }
    if (isOpen(i)) h += painBox(i);
    h += '<div class="les-actions">';
    if (i.status === 'activa') h += '<button class="btn small" onclick="SizigiaLesiones.setStatus(\'' + E(i.id) + '\',\'rehabilitacion\')">Pasar a rehabilitación</button>';
    if (isOpen(i)) h += '<input type="date" id="la_' + E(i.id) + '" value="' + todayISO() + '" max="' + todayISO() + '" style="border:1px solid var(--line);border-radius:8px;padding:4px 6px;font-size:12px"><button class="btn small" onclick="SizigiaLesiones.setStatus(\'' + E(i.id) + '\',\'alta\')">Dar de alta</button>';
    else h += '<button class="btn small" onclick="SizigiaLesiones.setStatus(\'' + E(i.id) + '\',\'activa\')">Reabrir (recaída)</button>';
    h += '<button class="btn small" onclick="SizigiaLesiones.edit(\'' + E(i.id) + '\')">Editar</button></div>';
    if (ui.msg && ui.msgFor === i.id) h += '<div class="les-err">' + E(ui.msg) + '</div>';
    return h + '</div>';
  }

  function tab() {
    ensure();
    var list = sortInjuries(state.injuries), open = list.filter(isOpen), closed = list.filter(function (i) { return !isOpen(i); });
    var h = '<div class="card" style="margin-bottom:16px;"><h3>Lesiones y rehabilitación</h3><div class="card-sub">Historial de cada lesión y tu dolor diario (EVA 0-10). Cada cambio queda en tu hoja de vida. Tu equipo lo ve solo si autorizas el permiso de lesiones.</div>';
    h += '<div class="tc-note">Registro informativo para conversar con tu tratante. No reemplaza una evaluación clínica: si el dolor aumenta o aparece algo nuevo, consulta.</div>';
    if (!ui.formOpen) h += '<div style="margin-top:10px"><button class="btn small primary" onclick="SizigiaLesiones.openForm(true)">Registrar lesión</button></div>';
    else {
      h += '<div style="margin-top:10px">' + formHTML(null) + '<div class="les-actions"><button class="btn small primary" onclick="SizigiaLesiones.create()">Guardar lesión</button><button class="btn small" onclick="SizigiaLesiones.openForm(false)">Cancelar</button></div>';
      if (ui.msg && !ui.editing && !ui.msgFor) h += '<div class="les-err">' + E(ui.msg) + '</div>';
      h += '</div>';
    }
    h += '</div>';
    if (ui.loading && !list.length) return h + '<div class="tc-empty">Cargando lesiones…</div>';
    if (!list.length) return h + '<div class="tc-empty">No tienes lesiones registradas.</div>';
    h += '<h3 style="margin:6px 0 10px">Abiertas (' + open.length + ')</h3>' + (open.length ? open.map(injuryCard).join('') : '<div class="tc-empty">Ninguna lesión abierta.</div>');
    if (closed.length) h += '<h3 style="margin:18px 0 10px">Historial (' + closed.length + ')</h3>' + closed.map(injuryCard).join('');
    return h;
  }

  function afterRender() {
    if (!root.SizigiaCharts || !state.injuries) return;
    state.injuries.filter(isOpen).forEach(function (i) {
      var el = document.getElementById('les-chart-' + i.id);
      if (!el) return;
      var pts = (state.injuryPain[i.id] || []).map(function (x) { return { iso: x.log_date, value: Number(x.eva) }; });
      root.SizigiaCharts.mount(el, pts, { metric: 'pain', label: 'Dolor (EVA) en ' + injuryName(i).toLowerCase(), today: todayISO(), days: 14 });
    });
  }

  // ---------- Acciones ----------
  async function persist(prev, next) {
    if (isDemoMode || !currentPatientId) {
      journalLocal(prev, next);
      if (prev) Object.assign(prev, next); else state.injuries.unshift(next);
      return true;
    }
    var row = Object.assign({}, next); delete row.id; delete row.created_at; delete row.updated_at;
    var r = prev ? await supabaseClient.from('injuries').update(row).eq('id', prev.id).select().single()
                 : await supabaseClient.from('injuries').insert(Object.assign(row, { patient_id: currentPatientId })).select().single();
    if (r.error) return false;
    if (prev) Object.assign(prev, r.data); else state.injuries.unshift(r.data);
    await reloadJournal();
    return true;
  }
  async function apply(prev, changes, errFor) {
    var next = Object.assign({}, prev || { id: lid(), status: 'activa', discharge_date: null }, changes);
    var err = validate(next, todayISO());
    ui.msgFor = errFor || null;
    if (err) { ui.msg = err; return render(); }
    var ok = await persist(prev, next);
    if (!ok) { ui.msg = 'No se pudo guardar. Reintenta en un momento.'; return render(); }
    ui.msg = ''; ui.msgFor = null;
    return true;
  }
  async function create() {
    if (await apply(null, readForm('ln_')) === true) { ui.formOpen = false; done(); }
  }
  async function saveEdit(id) {
    if (await apply(find(id), readForm('le_')) === true) { ui.editing = null; done(); }
  }
  async function setStatus(id, status) {
    var i = find(id), ch = { status: status, discharge_date: null };
    if (status === 'alta') { var d = document.getElementById('la_' + id); ch.discharge_date = (d && d.value) || todayISO(); }
    if (await apply(i, ch, id) === true) done();
  }
  async function savePain(id) {
    var el = document.getElementById('lp_' + id), t = todayISO();
    if (!el || el.value === '') { ui.painMsg[id] = 'Elige un valor de 0 a 10.'; return render(); }
    var row = { log_date: t, eva: Number(el.value) };
    if (!isDemoMode && currentPatientId) {
      var r = await supabaseClient.from('injury_pain_logs').upsert({ injury_id: id, patient_id: currentPatientId, log_date: t, eva: row.eva }, { onConflict: 'injury_id,log_date' });
      if (r.error) { ui.painMsg[id] = 'No se pudo guardar. Reintenta.'; return render(); }
    }
    var logs = (state.injuryPain[id] = (state.injuryPain[id] || []).filter(function (x) { return x.log_date !== t; }));
    logs.push(row);
    ui.painMsg[id] = 'Guardado.'; done();
  }

  root.SizigiaLesiones = Object.assign({}, core, {
    tab: tab, afterRender: afterRender,
    openForm: function (on) { ui.formOpen = on; ui.msg = ''; ui.msgFor = null; render(); },
    edit: function (id) { ui.editing = id; ui.msg = ''; ui.msgFor = null; render(); },
    create: create, saveEdit: saveEdit, setStatus: setStatus, savePain: savePain
  });
})(typeof window !== 'undefined' ? window : globalThis);
