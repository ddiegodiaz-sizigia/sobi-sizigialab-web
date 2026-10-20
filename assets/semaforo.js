// Reglas del semáforo de disponibilidad. Compartido por admin.html y equipo.html.
// ============ SEMÁFORO DE DISPONIBILIDAD v1 (reglas simples y explicables, sin ML) ============
// PROPUESTA pendiente de validación por el Dr. Acuña: los umbrales son ajustables acá.
// Es una señal para conversar antes de entrenar, no un diagnóstico ni una predicción clínica.
// Todos los datos son autoinformados por el atleta en su registro deportivo (tabla athlete_logs).
const SEM_RULES = {
  maxAgeDays: 2,          // un registro más viejo que esto = "sin datos", nunca verde
  painRed: 7,             // dolor >= 7 en el último registro
  painRedStreak: { days: 3, level: 5 },   // dolor >= 5 en los últimos 3 registros consecutivos
  painYellow: 4,
  sleepLastYellow: 6,     // horas anoche
  sleepAvg3Yellow: 6.5,   // promedio últimos 3 registros
  fatigueYellow: 8,
  fatigueRiseYellow: 2,   // fatiga prom. 3 últimos vs. línea base (registros previos de 28 días, mínimo 7)
  moodYellow: 3,
  acwrYellow: 1.5,        // carga 7 días / promedio semanal de 28 días (mínimo 21 días con registros en la ventana)
  baselineMinLogs: 7,
  acwrMinSpanDays: 21
};
const SEM_LABEL = { rojo: 'Revisar con el médico antes de entrenar', amarillo: 'Precaución: conversar con el atleta', verde: 'Sin alertas en los datos cargados', gris: 'Sin datos recientes' };

function semToday() { const d = new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function semDaysAgo(iso) { return Math.round((new Date(semToday() + 'T00:00:00') - new Date(iso + 'T00:00:00')) / 86400000); }
function semFmt(iso) { return iso.slice(8, 10) + '-' + iso.slice(5, 7); }
function semAvg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }
function semLoad(l) { return l.trained && l.session_rpe && l.session_minutes ? l.session_rpe * l.session_minutes : 0; }

// logs: filas de athlete_logs de UN paciente (cualquier orden). Devuelve { level, reasons:[{level,text}], last }
function computeSemaforo(logsIn) {
  const R = SEM_RULES;
  const logs = (logsIn || []).slice().sort((a, b) => a.log_date < b.log_date ? 1 : -1);
  if (!logs.length) return { level: 'gris', reasons: [{ level: 'gris', text: 'Sin registros deportivos cargados.' }], last: null };
  const last = logs[0];
  const age = semDaysAgo(last.log_date);
  if (age > R.maxAgeDays) return { level: 'gris', reasons: [{ level: 'gris', text: 'Último registro hace ' + age + ' días (' + semFmt(last.log_date) + '): no hay dato vigente.' }], last: last };

  const reasons = [];
  const add = (level, text) => reasons.push({ level: level, text: text });
  const zone = l => l.pain_zone ? ' en ' + l.pain_zone.toLowerCase() : '';

  if (last.pain_level != null && last.pain_level >= R.painRed) add('rojo', 'Dolor ' + last.pain_level + '/10' + zone(last) + ' el ' + semFmt(last.log_date) + '.');
  const streak = logs.slice(0, R.painRedStreak.days);
  if (streak.length === R.painRedStreak.days && streak.every(l => l.pain_level != null && l.pain_level >= R.painRedStreak.level) &&
      semDaysAgo(streak[streak.length - 1].log_date) <= R.painRedStreak.days + 1 && !(last.pain_level >= R.painRed)) {
    add('rojo', 'Dolor ≥ ' + R.painRedStreak.level + '/10 en los últimos ' + R.painRedStreak.days + ' registros' + zone(last) + ' (' + semFmt(streak[streak.length - 1].log_date) + ' al ' + semFmt(last.log_date) + ').');
  }
  if (last.pain_level != null && last.pain_level >= R.painYellow && last.pain_level < R.painRed && !reasons.some(r => r.level === 'rojo')) {
    add('amarillo', 'Dolor ' + last.pain_level + '/10' + zone(last) + ' el ' + semFmt(last.log_date) + '.');
  }
  if (last.sleep_hours != null && last.sleep_hours < R.sleepLastYellow) add('amarillo', 'Durmió ' + last.sleep_hours + ' h la noche del ' + semFmt(last.log_date) + ' (umbral ' + R.sleepLastYellow + ' h).');
  const last3 = logs.slice(0, 3);
  const sl3 = last3.filter(l => l.sleep_hours != null).map(l => Number(l.sleep_hours));
  if (sl3.length === 3 && semAvg(sl3) < R.sleepAvg3Yellow) {
    add('amarillo', 'Sueño promedio de ' + semAvg(sl3).toFixed(1) + ' h en los últimos 3 registros (umbral ' + R.sleepAvg3Yellow + ' h).');
  }
  if (last.fatigue != null && last.fatigue >= R.fatigueYellow) add('amarillo', 'Fatiga ' + last.fatigue + '/10 el ' + semFmt(last.log_date) + '.');
  const fat3 = last3.filter(l => l.fatigue != null).map(l => l.fatigue);
  const base = logs.slice(3).filter(l => semDaysAgo(l.log_date) <= 28 && l.fatigue != null).map(l => l.fatigue);
  if (fat3.length === 3 && base.length >= R.baselineMinLogs && semAvg(fat3) - semAvg(base) >= R.fatigueRiseYellow && !(last.fatigue >= R.fatigueYellow)) {
    add('amarillo', 'Fatiga promedio de 3 días (' + semAvg(fat3).toFixed(1) + ') sobre su línea base de 28 días (' + semAvg(base).toFixed(1) + ').');
  }
  if (last.mood != null && last.mood <= R.moodYellow) add('amarillo', 'Ánimo ' + last.mood + '/10 el ' + semFmt(last.log_date) + '.');

  const win28 = logs.filter(l => semDaysAgo(l.log_date) <= 27);
  if (win28.length) {
    const span = semDaysAgo(win28[win28.length - 1].log_date);
    const acute = logs.filter(l => semDaysAgo(l.log_date) <= 6).reduce((a, l) => a + semLoad(l), 0);
    const chronicWeekly = win28.reduce((a, l) => a + semLoad(l), 0) / 4;
    if (span >= R.acwrMinSpanDays && chronicWeekly > 0 && acute / chronicWeekly > R.acwrYellow) {
      add('amarillo', 'Carga de 7 días (' + acute + ' u.a.) es ' + (acute / chronicWeekly).toFixed(1) + '× su promedio semanal de 28 días (' + Math.round(chronicWeekly) + ' u.a.).');
    }
  }

  const level = reasons.some(r => r.level === 'rojo') ? 'rojo' : reasons.length ? 'amarillo' : 'verde';
  const checks = semChecks(logs, last);
  return { level: level, reasons: reasons, last: last, checks: checks, why: semWhy(level, checks, last) };
}


// ============ EXPLICACIÓN: qué se revisó y por qué sale este color ============
// Cada control dice si pasó, si dio alerta o si no hay dato. Así "verde" siempre viene con su evidencia.
function semChecks(logs, last) {
  const R = SEM_RULES, out = [];
  const add = (key, label, status, detail) => out.push({ key: key, label: label, status: status, detail: detail });
  const has = v => v != null;
  const f = n => String(n).replace('.', ',');
  if (has(last.pain_level)) add('dolor', 'Dolor', last.pain_level >= R.painRed ? 'alert' : last.pain_level >= R.painYellow ? 'warn' : 'ok',
    last.pain_level + '/10 (precaución desde ' + R.painYellow + ', revisar desde ' + R.painRed + ')');
  else add('dolor', 'Dolor', 'nodata', 'no informado');
  if (has(last.sleep_hours)) add('sueno', 'Sueño de anoche', last.sleep_hours < R.sleepLastYellow ? 'warn' : 'ok',
    f(last.sleep_hours) + ' h (precaución bajo ' + R.sleepLastYellow + ' h)');
  else add('sueno', 'Sueño de anoche', 'nodata', 'no informado');
  const sl3 = logs.slice(0, 3).filter(l => has(l.sleep_hours)).map(l => Number(l.sleep_hours));
  if (sl3.length === 3) add('sueno3', 'Sueño, últimos 3 registros', semAvg(sl3) < R.sleepAvg3Yellow ? 'warn' : 'ok',
    'promedio ' + f(semAvg(sl3).toFixed(1)) + ' h (precaución bajo ' + f(R.sleepAvg3Yellow) + ' h)');
  if (has(last.fatigue)) add('fatiga', 'Fatiga', last.fatigue >= R.fatigueYellow ? 'warn' : 'ok', last.fatigue + '/10 (precaución desde ' + R.fatigueYellow + ')');
  else add('fatiga', 'Fatiga', 'nodata', 'no informado');
  if (has(last.mood)) add('animo', 'Ánimo', last.mood <= R.moodYellow ? 'warn' : 'ok', last.mood + '/10 (precaución en ' + R.moodYellow + ' o menos)');
  else add('animo', 'Ánimo', 'nodata', 'no informado');
  const win28 = logs.filter(l => semDaysAgo(l.log_date) <= 27);
  const span = win28.length ? semDaysAgo(win28[win28.length - 1].log_date) : 0;
  const chronic = win28.reduce((a, l) => a + semLoad(l), 0) / 4;
  if (span >= R.acwrMinSpanDays && chronic > 0) {
    const acute = logs.filter(l => semDaysAgo(l.log_date) <= 6).reduce((a, l) => a + semLoad(l), 0);
    const r = acute / chronic;
    add('carga', 'Carga de la semana', r > R.acwrYellow ? 'warn' : 'ok', f(r.toFixed(1)) + '× su promedio de 28 días (precaución sobre ' + f(R.acwrYellow) + '×)');
  } else add('carga', 'Carga de la semana', 'nodata', 'faltan registros: se necesitan ' + R.acwrMinSpanDays + ' días de historia con sesiones');
  return out;
}

// Texto corto que responde "¿por qué este color?". Verde nunca se declara como "sano".
function semWhy(level, checks, last) {
  const ok = checks.filter(c => c.status === 'ok'), nd = checks.filter(c => c.status === 'nodata');
  if (level === 'gris') return 'Gris porque no hay un registro de los últimos ' + SEM_RULES.maxAgeDays + ' días. Sin dato vigente el semáforo nunca puede ser verde.';
  if (level === 'verde') {
    return 'Verde porque el registro del ' + semFmt(last.log_date) + ' pasó los ' + ok.length + ' controles con dato (' + ok.map(c => c.label.toLowerCase()).join(', ') + ')' +
      (nd.length ? ' y no hay dato para: ' + nd.map(c => c.label.toLowerCase()).join(', ') : '') +
      '. Verde significa "sin alertas en lo que la persona informó", no que esté sana ni apta: no incluye wearables, exámenes ni evaluación clínica.';
  }
  return (level === 'rojo' ? 'Rojo' : 'Amarillo') + ' porque ' + checks.filter(c => c.status !== 'ok' && c.status !== 'nodata').map(c => c.label.toLowerCase() + ' ' + c.detail).join('; ') + '.';
}
const SEM_CHECK_ICON = { ok: '✓', warn: '!', alert: '✕', nodata: '–' };
function semChecksHTML(checks, why, esc) {
  esc = esc || (s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
  return '<details class="sem-why"><summary>¿Por qué este color?</summary><div class="sem-why-text">' + esc(why) + '</div>' +
    checks.map(c => '<div class="sem-check ' + c.status + '"><span class="sem-check-ic" aria-hidden="true">' + SEM_CHECK_ICON[c.status] + '</span> <b>' + esc(c.label) + ':</b> ' + esc(c.detail) + '</div>').join('') + '</details>';
}
if (typeof module !== 'undefined' && module.exports) module.exports = { SEM_RULES, computeSemaforo, semChecks, semWhy };
