// Registro diario único (fase 2 del rediseño): una pregunta por pantalla, respuestas a toques, menos de 30 segundos.
// Reemplaza los formularios sueltos de Resumen en la versión nueva (?v=2, assets/hoy.js). Escribe en las mismas tablas:
// athlete_logs (modo deportivo), wellness_logs (modo general, vía SizigiaRegistro.saveRow), injury_pain_logs
// (SizigiaLesiones.savePainValue) y cycle_logs (SizigiaPersona.saveCycleRow). Nada nuevo en la base.
// Núcleo puro exportado para Node (tests/registro-diario.test.mjs). La pantalla usa los globals de rueda_final.html.
(function (root) {
  'use strict';

  // ---------- Núcleo puro ----------
  function blank(v) { return v == null || v === ''; }
  function isInt(v, lo, hi) { return !blank(v) && Number(v) === Math.round(Number(v)) && Number(v) >= lo && Number(v) <= hi; }

  // ctx: { mode: 'deportivo'|'comun', frequency: 'diaria'|'semanal', habits: [], injuries: [{id, name, last}], cycle: bool }
  function steps(ctx) {
    var weekly = ctx.mode === 'comun' && ctx.frequency === 'semanal', out = ['sueno'];
    if (ctx.mode === 'comun') out.push('energia', 'estres');
    else out.push('fatiga', 'animo', 'dolor');
    if ((ctx.injuries || []).length && !weekly) out.push('lesiones');
    if (ctx.mode !== 'comun') out.push('entreno');
    if (ctx.mode === 'comun' && (ctx.habits || []).length) out.push('habitos');
    if (ctx.cycle && !weekly) out.push('ciclo');
    out.push('nota');
    return out;
  }

  // Respuestas iniciales: lo ya registrado hoy, o vacío para que cada escala se elija con un toque.
  // ex: { athlete, wellness, pain: {id: eva}, cycle }
  function defaults(ctx, ex) {
    ex = ex || {};
    var a = ex.athlete || {}, w = ex.wellness || {}, c = ex.cycle || null, pain = ex.pain || {};
    var src = ctx.mode === 'comun' ? w : a, ans = {
      sleep_hours: !blank(src.sleep_hours) ? Number(src.sleep_hours) : 7,
      sleep_quality: blank(src.sleep_quality) ? null : Number(src.sleep_quality),
      notes: src.notes || ''
    };
    if (ctx.mode === 'comun') {
      ans.energy = blank(w.energy) ? null : Number(w.energy);
      ans.stress = blank(w.stress) ? null : Number(w.stress);
      ans.habits = {};
      (ctx.habits || []).forEach(function (h) { var v = (w.habits || {})[h]; ans.habits[h] = blank(v) ? 0 : Number(v); });
    } else {
      ans.fatigue = blank(a.fatigue) ? null : Number(a.fatigue);
      ans.mood = blank(a.mood) ? null : Number(a.mood);
      ans.pain_level = blank(a.pain_level) ? null : Number(a.pain_level);
      ans.pain_zone = a.pain_zone || '';
      ans.trained = a.trained == null ? null : !!a.trained;
      ans.session_rpe = blank(a.session_rpe) ? null : Number(a.session_rpe);
      ans.session_minutes = blank(a.session_minutes) ? 60 : Number(a.session_minutes);
    }
    ans.injuries = {};
    (ctx.injuries || []).forEach(function (i) { ans.injuries[i.id] = blank(pain[i.id]) ? null : Number(pain[i.id]); });
    ans.bleeding = c ? !!c.bleeding : null;
    ans.flow = c && c.flow ? Number(c.flow) : null;
    ans.symptoms = c && c.symptoms ? c.symptoms.slice() : [];
    return ans;
  }

  // Devuelve el mensaje de error del paso, o null si se puede seguir.
  function validateStep(step, ans, ctx) {
    var weekly = ctx.mode === 'comun' && ctx.frequency === 'semanal';
    if (step === 'sueno') {
      if (blank(ans.sleep_hours) || !(Number(ans.sleep_hours) >= 0 && Number(ans.sleep_hours) <= 16)) return 'Las horas de sueño van de 0 a 16.';
      if (ctx.mode !== 'comun' && !isInt(ans.sleep_quality, 1, 10)) return 'Elige qué tan bien dormiste.';
      return null;
    }
    if (step === 'energia') return isInt(ans.energy, 1, 10) ? null : 'Elige tu energía' + (weekly ? ' de la semana.' : ' de hoy.');
    if (step === 'estres') return isInt(ans.stress, 1, 10) ? null : 'Elige tu nivel de estrés.';
    if (step === 'fatiga') return isInt(ans.fatigue, 1, 10) ? null : 'Elige tu fatiga de hoy.';
    if (step === 'animo') return isInt(ans.mood, 1, 10) ? null : 'Elige tu ánimo de hoy.';
    if (step === 'dolor') return isInt(ans.pain_level, 0, 10) ? null : 'Elige 0 si no tienes dolor.';
    if (step === 'lesiones') {
      var miss = (ctx.injuries || []).filter(function (i) { return !isInt(ans.injuries[i.id], 0, 10); })[0];
      return miss ? 'Elige el dolor de hoy en ' + miss.name + ' (0 si no duele).' : null;
    }
    if (step === 'entreno') {
      if (ans.trained == null) return 'Responde si entrenaste hoy.';
      if (ans.trained && !isInt(ans.session_rpe, 1, 10)) return 'Elige qué tan exigente fue la sesión.';
      if (ans.trained && !(Number(ans.session_minutes) > 0 && Number(ans.session_minutes) <= 600)) return 'Indica cuántos minutos duró (1 a 600).';
      return null;
    }
    if (step === 'habitos') {
      var max = weekly ? 7 : 1, bad = (ctx.habits || []).filter(function (h) { return !isInt(ans.habits[h], 0, max); })[0];
      return bad ? 'Revisa el hábito "' + bad + '".' : null;
    }
    if (step === 'ciclo') return ans.bleeding == null ? 'Responde si hubo sangrado hoy.' : null;
    if (step === 'nota') return String(ans.notes || '').length > 1000 ? 'La nota puede tener hasta 1.000 letras.' : null;
    return null;
  }
  function firstError(ctx, ans) {
    var list = steps(ctx);
    for (var k = 0; k < list.length; k++) { var e = validateStep(list[k], ans, ctx); if (e) return { step: k, error: e }; }
    return null;
  }

  // Filas a guardar. today: 'YYYY-MM-DD'; weekDate: lunes que toca en registro semanal.
  function buildRows(ctx, ans, today, weekDate) {
    var notes = String(ans.notes || '').trim() || null, out = { athlete: null, wellness: null, pain: [], cycle: null };
    if (ctx.mode === 'comun') {
      var weekly = ctx.frequency === 'semanal', habits = {};
      (ctx.habits || []).forEach(function (h) { habits[h] = Number(ans.habits[h] || 0); });
      out.wellness = { period: weekly ? 'semana' : 'dia', log_date: weekly ? weekDate : today, energy: Number(ans.energy), sleep_hours: Number(ans.sleep_hours),
        sleep_quality: blank(ans.sleep_quality) ? null : Number(ans.sleep_quality), stress: Number(ans.stress), habits: habits, notes: notes };
    } else {
      var pain = Number(ans.pain_level), trained = !!ans.trained;
      out.athlete = { log_date: today, sleep_hours: Number(ans.sleep_hours), sleep_quality: Number(ans.sleep_quality), fatigue: Number(ans.fatigue), mood: Number(ans.mood),
        pain_level: pain, pain_zone: pain > 0 && ans.pain_zone ? ans.pain_zone : null, trained: trained,
        session_rpe: trained ? Number(ans.session_rpe) : null, session_minutes: trained ? Number(ans.session_minutes) : null, notes: notes };
    }
    var list = steps(ctx);
    if (list.indexOf('lesiones') >= 0) (ctx.injuries || []).forEach(function (i) { out.pain.push({ id: i.id, eva: Number(ans.injuries[i.id]) }); });
    if (list.indexOf('ciclo') >= 0) out.cycle = { bleeding: !!ans.bleeding, flow: ans.bleeding && ans.flow ? Number(ans.flow) : null, symptoms: (ans.symptoms || []).slice() };
    return out;
  }

  var core = { steps: steps, defaults: defaults, validateStep: validateStep, firstError: firstError, buildRows: buildRows };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }

  // ---------- Pantalla ----------
  var TITLES = {
    sueno: ['¿Cómo dormiste?', 'Horas de sueño anoche y qué tan bien descansaste.'],
    energia: ['¿Cómo está tu energía?', '1 = sin energía · 10 = mucha energía'],
    estres: ['¿Cuánto estrés sientes?', '1 = tranquilo · 10 = muy estresado'],
    fatiga: ['¿Cuánta fatiga sientes?', '1 = fresco · 10 = agotado'],
    animo: ['¿Cómo está tu ánimo?', '1 = muy bajo · 10 = muy bien'],
    dolor: ['¿Algún dolor o molestia?', '0 = nada · 10 = máximo'],
    lesiones: ['¿Cómo están tus lesiones hoy?', 'Dolor de 0 a 10 en cada una.'],
    entreno: ['¿Entrenaste hoy?', 'Si hubo sesión, qué tan exigente fue y cuánto duró.'],
    habitos: ['Tus hábitos', ''],
    ciclo: ['Tu ciclo', 'Solo tú ves esto, salvo que lo autorices a tu equipo.'],
    nota: ['¿Algo que tu equipo deba saber?', 'Opcional. Lo ven quienes tienen permiso sobre tu registro.']
  };
  var ui = null; // { ctx, ans, step, error, saving }
  var E = function (s) { return escapeHtml(s == null ? '' : String(s)); };

  var css = '.rd-back{position:fixed;inset:0;background:rgba(29,29,26,.35);z-index:60;display:flex;align-items:flex-end;justify-content:center}' +
    '.rd-sheet{background:var(--paper);width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:20px 20px 24px;box-sizing:border-box}' +
    '@media (min-width:700px){.rd-back{align-items:center}.rd-sheet{border-radius:18px}}' +
    '.rd-top{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted)}.rd-x{border:none;background:none;font-size:15px;color:var(--muted);cursor:pointer;font-family:inherit;padding:6px}' +
    '.rd-bar{height:4px;background:var(--gray-bg);border-radius:2px;margin:10px 0 18px;overflow:hidden}.rd-bar span{display:block;height:100%;background:var(--accent)}' +
    '.rd-q{font-family:Georgia,"Times New Roman",serif;font-size:24px;font-weight:400;margin:0 0 4px}.rd-hint{font-size:14.5px;color:var(--muted);margin:0 0 16px}' +
    '.rd-lbl{font-size:15px;font-weight:600;margin:16px 0 8px}.rd-scale{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}.rd-scale.z{grid-template-columns:repeat(6,1fr)}' +
    '.rd-opt{border:1px solid var(--line);background:#fff;border-radius:12px;padding:12px 0;font-size:17px;font-weight:600;cursor:pointer;font-family:inherit;color:var(--ink)}' +
    '.rd-opt.on{background:var(--ink);border-color:var(--ink);color:#fff}.rd-row{display:flex;gap:8px;flex-wrap:wrap}.rd-row .rd-opt{padding:12px 18px}' +
    '.rd-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font-size:15px;cursor:pointer;font-family:inherit;color:var(--ink)}.rd-chip.on{background:var(--ink);border-color:var(--ink);color:#fff}' +
    '.rd-step{display:flex;align-items:center;gap:14px}.rd-step button{width:48px;height:48px;border-radius:50%;border:1px solid var(--line);background:#fff;font-size:22px;cursor:pointer;color:var(--ink)}.rd-step b{font-size:28px;min-width:90px;text-align:center}' +
    '.rd-err{color:var(--red);font-size:14.5px;margin-top:14px}.rd-nav{display:flex;justify-content:space-between;gap:10px;margin-top:24px}.rd-nav .btn{padding:12px 20px;font-size:16px}' +
    '.rd-sheet textarea{width:100%;min-height:110px;border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-family:inherit;font-size:16px;box-sizing:border-box;background:#fff}' +
    '.rd-hab{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:16px}';
  function ensureCss() { if (!document.getElementById('registro-diario-css')) { var s = document.createElement('style'); s.id = 'registro-diario-css'; s.textContent = css; document.head.appendChild(s); } }

  function context() {
    var R = root.SizigiaRegistro, s = R ? R.settings() : { mode: 'deportivo', frequency: 'diaria', habits: [] };
    return { mode: s.mode, frequency: s.frequency, habits: s.habits || [],
      injuries: root.SizigiaLesiones ? root.SizigiaLesiones.openToday() : [],
      cycle: !!(root.SizigiaPersona && root.SizigiaPersona.tracksCycle()) };
  }
  function existing(ctx) {
    var t = todayISO(), pain = {};
    (ctx.injuries || []).forEach(function (i) { if (i.eva != null) pain[i.id] = i.eva; });
    return { athlete: athleteLogs()[t] || null, wellness: ctx.mode === 'comun' && root.SizigiaRegistro ? (root.SizigiaRegistro.current().row || null) : null,
      pain: pain, cycle: root.SizigiaPersona ? root.SizigiaPersona.cycleToday() : null };
  }
  // ¿Ya está el registro de hoy (o de la semana)? Para la pantalla Hoy.
  function doneToday() {
    var R = root.SizigiaRegistro;
    if (R && R.isComun()) return !!R.current().row;
    return !!athleteLogs()[todayISO()];
  }

  function scale(key, lo, hi, val, extra) {
    var h = '<div class="rd-scale' + (hi - lo + 1 === 11 ? ' z' : '') + '">';
    for (var n = lo; n <= hi; n++) h += '<button type="button" class="rd-opt' + (val === n ? ' on' : '') + '" onclick="SizigiaDiario.set(\'' + key + '\',' + n + (extra ? ',\'' + extra + '\'' : '') + ')">' + n + '</button>';
    return h + '</div>';
  }
  function yesNo(key, val) {
    return '<div class="rd-row"><button type="button" class="rd-opt' + (val === true ? ' on' : '') + '" onclick="SizigiaDiario.set(\'' + key + '\',true)">Sí</button>' +
      '<button type="button" class="rd-opt' + (val === false ? ' on' : '') + '" onclick="SizigiaDiario.set(\'' + key + '\',false)">No</button></div>';
  }
  function stepper(key, val, by, unit) {
    return '<div class="rd-step"><button type="button" onclick="SizigiaDiario.bump(\'' + key + '\',' + (-by) + ')" aria-label="Menos">−</button><b>' + E(String(val).replace('.', ',')) + ' ' + unit + '</b>' +
      '<button type="button" onclick="SizigiaDiario.bump(\'' + key + '\',' + by + ')" aria-label="Más">+</button></div>';
  }

  function body(step) {
    var a = ui.ans, ctx = ui.ctx, weekly = ctx.mode === 'comun' && ctx.frequency === 'semanal';
    if (step === 'sueno') {
      return '<div class="rd-lbl">' + (weekly ? 'Horas por noche, en promedio' : 'Horas anoche') + '</div>' + stepper('sleep_hours', a.sleep_hours, 0.5, 'h') +
        '<div class="rd-lbl">Calidad del sueño' + (ctx.mode === 'comun' ? ' (opcional)' : '') + '</div>' + scale('sleep_quality', 1, 10, a.sleep_quality);
    }
    if (step === 'energia') return scale('energy', 1, 10, a.energy);
    if (step === 'estres') return scale('stress', 1, 10, a.stress);
    if (step === 'fatiga') return scale('fatigue', 1, 10, a.fatigue);
    if (step === 'animo') return scale('mood', 1, 10, a.mood);
    if (step === 'dolor') {
      var h = scale('pain_level', 0, 10, a.pain_level);
      if (a.pain_level > 0) h += '<div class="rd-lbl">¿Dónde?</div><div class="rd-row">' + (root.PAIN_ZONES || PAIN_ZONES).map(function (z) {
        return '<button type="button" class="rd-chip' + (a.pain_zone === z ? ' on' : '') + '" onclick="SizigiaDiario.setText(\'pain_zone\',this.textContent)">' + E(z) + '</button>'; }).join('') + '</div>';
      return h;
    }
    if (step === 'lesiones') return ctx.injuries.map(function (i) {
      return '<div class="rd-lbl">' + E(i.name) + (i.last != null ? ' <span style="font-weight:400;color:var(--muted)">· último registro: ' + i.last + '</span>' : '') + '</div>' + scale('injury', 0, 10, a.injuries[i.id], i.id);
    }).join('');
    if (step === 'entreno') {
      var t = yesNo('trained', a.trained);
      if (a.trained) t += '<div class="rd-lbl">¿Qué tan exigente fue?</div>' + scale('session_rpe', 1, 10, a.session_rpe) + '<div class="rd-lbl">Duración</div>' + stepper('session_minutes', a.session_minutes, 5, 'min');
      return t;
    }
    if (step === 'habitos') return ctx.habits.map(function (hb, k) {
      var v = a.habits[hb];
      return '<div class="rd-hab"><span>' + E(hb) + '</span>' + (weekly
        ? '<div class="rd-step"><button type="button" onclick="SizigiaDiario.habit(' + k + ',-1)">−</button><b style="font-size:20px;min-width:70px">' + v + (v === 1 ? ' día' : ' días') + '</b><button type="button" onclick="SizigiaDiario.habit(' + k + ',1)">+</button></div>'
        : '<div class="rd-row"><button type="button" class="rd-opt' + (v === 1 ? ' on' : '') + '" onclick="SizigiaDiario.habit(' + k + ',1)">Hecho</button><button type="button" class="rd-opt' + (v === 0 ? ' on' : '') + '" onclick="SizigiaDiario.habit(' + k + ',0)">No</button></div>') + '</div>';
    }).join('');
    if (step === 'ciclo') {
      var c = '<div class="rd-lbl">¿Sangrado hoy?</div>' + yesNo('bleeding', a.bleeding);
      if (a.bleeding) c += '<div class="rd-lbl">Flujo</div><div class="rd-row">' + ['Escaso', 'Moderado', 'Abundante'].map(function (n, k) {
        return '<button type="button" class="rd-chip' + (a.flow === k + 1 ? ' on' : '') + '" onclick="SizigiaDiario.set(\'flow\',' + (k + 1) + ')">' + n + '</button>'; }).join('') + '</div>';
      c += '<div class="rd-lbl">Síntomas (opcional)</div><div class="rd-row">' + root.SizigiaPersona.symptoms.map(function (s) {
        return '<button type="button" class="rd-chip' + (a.symptoms.indexOf(s) >= 0 ? ' on' : '') + '" onclick="SizigiaDiario.symptom(this.textContent)">' + E(s) + '</button>'; }).join('') + '</div>';
      return c;
    }
    if (step === 'nota') return '<textarea id="rd_notes" placeholder="Escribe aquí (opcional)" oninput="SizigiaDiario.setText(\'notes\',this.value,true)">' + E(a.notes) + '</textarea>';
    return '';
  }

  function sheet() {
    var list = steps(ui.ctx), step = list[ui.step], last = ui.step === list.length - 1, tt = TITLES[step];
    var weekly = ui.ctx.mode === 'comun' && ui.ctx.frequency === 'semanal';
    var hint = step === 'habitos' ? (weekly ? '¿Cuántos días de esta semana?' : '¿Cuáles cumpliste hoy?') : tt[1];
    var h = '<div class="rd-sheet" role="dialog" aria-modal="true" aria-label="Registrar mi día">';
    h += '<div class="rd-top"><span>Paso ' + (ui.step + 1) + ' de ' + list.length + '</span><button type="button" class="rd-x" onclick="SizigiaDiario.close()">Cerrar</button></div>';
    h += '<div class="rd-bar"><span style="width:' + Math.round((ui.step + 1) / list.length * 100) + '%"></span></div>';
    h += '<h2 class="rd-q">' + E(tt[0]) + '</h2>' + (hint ? '<p class="rd-hint">' + E(hint) + '</p>' : '') + body(step);
    if (ui.error) h += '<div class="rd-err">' + E(ui.error) + '</div>';
    h += '<div class="rd-nav">' + (ui.step > 0 ? '<button type="button" class="btn" onclick="SizigiaDiario.go(-1)">Atrás</button>' : '<span></span>') +
      '<button type="button" class="btn primary"' + (ui.saving ? ' disabled' : '') + ' onclick="SizigiaDiario.go(1)">' + (last ? (ui.saving ? 'Guardando…' : 'Guardar') : 'Siguiente') + '</button></div>';
    return h + '</div>';
  }
  function html() { return ui ? '<div class="rd-back" id="rd-back" onclick="if(event.target===this)SizigiaDiario.close()">' + sheet() + '</div>' : ''; }
  // Redibuja solo la hoja (cada toque), sin rehacer toda la app.
  function paint() {
    var el = document.getElementById('rd-back');
    if (!el) return render();
    el.innerHTML = sheet();
  }

  function open() {
    ensureCss();
    var ctx = context();
    ui = { ctx: ctx, ans: defaults(ctx, existing(ctx)), step: 0, error: '', saving: false };
    render();
  }
  function close() { ui = null; render(); }
  function set(key, v, id) {
    if (key === 'injury') ui.ans.injuries[id] = v; else ui.ans[key] = v;
    if (key === 'pain_level' && v === 0) ui.ans.pain_zone = '';
    ui.error = ''; paint();
  }
  function setText(key, v, quiet) { ui.ans[key] = key === 'pain_zone' && ui.ans.pain_zone === v ? '' : v; ui.error = ''; if (!quiet) paint(); }
  function bump(key, by) {
    var lim = key === 'sleep_hours' ? [0, 16] : [5, 600], v = Math.round((Number(ui.ans[key] || 0) + by) * 10) / 10;
    ui.ans[key] = Math.min(lim[1], Math.max(lim[0], v)); paint();
  }
  function habit(k, v) {
    var hb = ui.ctx.habits[k], weekly = ui.ctx.frequency === 'semanal';
    ui.ans.habits[hb] = weekly ? Math.min(7, Math.max(0, Number(ui.ans.habits[hb] || 0) + v)) : v; paint();
  }
  function symptom(s) { var l = ui.ans.symptoms, k = l.indexOf(s); if (k >= 0) l.splice(k, 1); else l.push(s); paint(); }

  async function go(dir) {
    var list = steps(ui.ctx);
    if (dir < 0) { ui.step = Math.max(0, ui.step - 1); ui.error = ''; return paint(); }
    var err = validateStep(list[ui.step], ui.ans, ui.ctx);
    if (err) { ui.error = err; return paint(); }
    if (ui.step < list.length - 1) { ui.step++; ui.error = ''; return paint(); }
    return save();
  }
  async function save() {
    var fe = firstError(ui.ctx, ui.ans);
    if (fe) { ui.step = fe.step; ui.error = fe.error; return paint(); }
    var R = root.SizigiaRegistro, t = todayISO();
    var rows = buildRows(ui.ctx, ui.ans, t, R && ui.ctx.mode === 'comun' ? R.current().date : t), errors = [];
    ui.saving = true; paint();
    if (rows.athlete) {
      var ok = true;
      if (!isDemoMode && currentPatientId) {
        var r = await supabaseClient.from('athlete_logs').upsert(Object.assign({ patient_id: currentPatientId, updated_at: new Date().toISOString() }, rows.athlete), { onConflict: 'patient_id,log_date' });
        if (r.error) { console.error('athlete_logs upsert error', r.error); ok = false; errors.push('No se pudo guardar el registro. Reintenta en un momento; si persiste, avisa a tu equipo.'); }
      }
      if (ok) athleteLogs()[t] = rows.athlete;
    }
    if (rows.wellness) { var we = await R.saveRow(rows.wellness); if (we) errors.push(we); }
    for (var k = 0; k < rows.pain.length; k++) { var pe = await root.SizigiaLesiones.savePainValue(rows.pain[k].id, rows.pain[k].eva); if (pe) errors.push(pe); }
    if (rows.cycle) { var ce = await root.SizigiaPersona.saveCycleRow(rows.cycle); if (ce) errors.push(ce); }
    ui.saving = false;
    if (errors.length) { ui.error = errors.join(' '); return paint(); }
    ui = null; saveState(); render();
  }

  root.SizigiaDiario = Object.assign({}, core, {
    html: html, open: open, close: close, isOpen: function () { return !!ui; }, doneToday: doneToday,
    set: set, setText: setText, bump: bump, habit: habit, symptom: symptom, go: go
  });
})(typeof window !== 'undefined' ? window : globalThis);
