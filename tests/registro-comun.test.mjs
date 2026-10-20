import { createRequire } from 'node:module'; import assert from 'node:assert/strict'; import { readFileSync } from 'node:fs';
const R = createRequire(import.meta.url)('../assets/registro-comun.js');

// Semanas: el registro semanal se guarda en el lunes. 2026-10-20 es martes.
assert.equal(R.mondayOf('2026-10-20'), '2026-10-19'); assert.equal(R.mondayOf('2026-10-19'), '2026-10-19'); assert.equal(R.mondayOf('2026-10-25'), '2026-10-19');
assert.equal(R.mondayOf('2026-11-01'), '2026-10-26', 'domingo pertenece a la semana que empezó el lunes anterior');
assert.equal(R.periodOf('semanal'), 'semana'); assert.equal(R.periodOf('diaria'), 'dia');

// Configuración: el deportivo siempre es diario; hábitos limpios, sin repetidos, máximo 8
assert.deepEqual(R.normalizeSettings({ mode: 'deportivo', frequency: 'semanal' }).frequency, 'diaria');
assert.deepEqual(R.normalizeSettings({ mode: 'comun', frequency: 'semanal', habits: [' Caminar ', 'caminar', '', 'Agua'] }), { mode: 'comun', frequency: 'semanal', habits: ['Caminar', 'Agua'], set_by: 'paciente' });
assert.equal(R.normalizeSettings({}).mode, 'deportivo', 'sin configuración = deportivo diario (nada cambia para quien ya registra)');
assert.equal(R.validateSettings({ mode: 'comun', frequency: 'semanal', habits: ['Caminar 30 minutos'] }), null);
assert.match(R.validateSettings({ mode: 'x' }), /tipo de registro/);
assert.match(R.validateSettings({ mode: 'comun', frequency: 'mensual', habits: [] }), /cada cuánto/);
assert.match(R.validateSettings({ mode: 'comun', frequency: 'diaria', habits: ['a'] }), /entre 2 y 40/);
assert.match(R.validateSettings({ mode: 'comun', frequency: 'diaria', habits: '123456789'.split('').map(n => 'Hábito ' + n) }), /Máximo 8/);

// Entrada de la hoja de vida: mismo texto que set_log_settings
assert.deepEqual(R.settingsSummary({ mode: 'comun', frequency: 'semanal', habits: ['Caminar', 'Agua'] }), { title: 'Registro: general semanal', body: 'Energía, sueño y estrés. Hábitos: Caminar, Agua.' });
assert.equal(R.settingsSummary({ mode: 'comun', frequency: 'diaria', habits: [] }, 'Tomás').body, 'Energía, sueño y estrés. Sin hábitos definidos. Definido por Tomás.');
assert.equal(R.settingsSummary({ mode: 'deportivo' }).title, 'Registro: deportivo diario');

// Validación del registro
const hab = ['Caminar', 'Agua'];
const day = { period: 'dia', log_date: '2026-10-20', energy: 6, sleep_hours: 7, sleep_quality: 7, stress: 4, habits: { Caminar: 1, Agua: 0 } };
assert.equal(R.validateLog(day, 'diaria', hab), null);
assert.match(R.validateLog({ ...day, energy: null }, 'diaria', hab), /energía/);
assert.match(R.validateLog({ ...day, energy: 11 }, 'diaria', hab), /energía/);
assert.match(R.validateLog({ ...day, sleep_hours: 20 }, 'diaria', hab), /anoche/);
assert.match(R.validateLog({ ...day, stress: 0 }, 'diaria', hab), /estrés/);
assert.match(R.validateLog({ ...day, habits: { Caminar: 2 } }, 'diaria', hab), /hecho o no/);
assert.match(R.validateLog({ ...day, habits: { Yoga: 1 } }, 'diaria', hab), /no está en tu plan/);
const week = { ...day, period: 'semana', log_date: '2026-10-19', habits: { Caminar: 5, Agua: 7 } };
assert.equal(R.validateLog(week, 'semanal', hab), null);
assert.match(R.validateLog({ ...week, log_date: '2026-10-20' }, 'semanal', hab), /lunes/);
assert.match(R.validateLog({ ...week, habits: { Caminar: 8 } }, 'semanal', hab), /0 a 7/);
assert.match(R.validateLog({ ...week, sleep_hours: null }, 'semanal', hab), /promedio por noche/);

// Qué toca hoy
const cfgD = { mode: 'comun', frequency: 'diaria' }, cfgW = { mode: 'comun', frequency: 'semanal' };
assert.equal(R.pending(cfgD, [day], '2026-10-20').due, false);
assert.equal(R.pending(cfgD, [day], '2026-10-21').due, true);
assert.deepEqual(R.pending(cfgW, [week], '2026-10-25'), { due: false, period: 'semana', date: '2026-10-19', label: 'semana del 19-10' });
assert.equal(R.pending(cfgW, [day], '2026-10-20').due, true, 'un registro diario no cuenta para el semanal');
// Lunes o martes sin nada: se ofrece la semana pasada; si ya está, la actual
assert.equal(R.defaultWeek('2026-10-20', []), '2026-10-12');
assert.equal(R.defaultWeek('2026-10-20', [{ period: 'semana', log_date: '2026-10-12' }]), '2026-10-19');
assert.equal(R.defaultWeek('2026-10-22', []), '2026-10-19', 'desde el miércoles, la semana en curso');

// Constancia y hábitos
const days = ['2026-10-20', '2026-10-19', '2026-10-17', '2026-10-10'].map((d, i) => ({ period: 'dia', log_date: d, energy: 6, sleep_hours: 7, stress: 4, habits: { Caminar: i % 2 ? 0 : 1, Agua: 1 } }));
assert.deepEqual(R.adherence(days, 'diaria', '2026-10-20'), { done: 3, expected: 7, text: 'Últimos 7 días: 3/7 registros' });
const weeks = ['2026-10-19', '2026-10-05', '2026-09-14'].map(d => ({ period: 'semana', log_date: d, energy: 6, sleep_hours: 7, stress: 4, habits: { Caminar: 4 } }));
assert.equal(R.adherence(weeks, 'semanal', '2026-10-20').text, 'Últimas 4 semanas: 2/4 registros');
assert.deepEqual(R.habitStats(days, ['Caminar', 'Agua', 'Yoga'], 'diaria', '2026-10-20'), [
  { habit: 'Caminar', done: 2, possible: 4, pct: 50 }, { habit: 'Agua', done: 4, possible: 4, pct: 100 }, { habit: 'Yoga', done: 0, possible: 0, pct: null }]);
assert.deepEqual(R.habitStats(weeks, ['Caminar'], 'semanal', '2026-10-20'), [{ habit: 'Caminar', done: 8, possible: 14, pct: 57 }], 'la semana del 14-09 queda fuera de las 4 semanas');
assert.equal(R.habitPct({ habits: { Caminar: 4, Agua: 7 } }, 'semanal'), 79);
assert.equal(R.habitPct({ habits: {} }, 'diaria'), null);
assert.deepEqual(R.trendPointsFrom(days.slice(0, 2), 'diaria', 'habits'), [{ iso: '2026-10-19', value: 50 }, { iso: '2026-10-20', value: 100 }], 'en orden de fecha');
assert.deepEqual(R.trendPointsFrom([...days, ...weeks], 'semanal', 'energy').map(p => p.iso), ['2026-09-14', '2026-10-05', '2026-10-12', '2026-10-19'], 'la semana del 12-10 solo tenía días: se arma con ellos');
assert.deepEqual(Object.keys(R.TREND_METRICS), ['energy', 'sleep', 'stress', 'habits']);

// Migración: idempotente, con RLS, sin escritura directa de la configuración y con acceso registrado del profesional
const sql = readFileSync(new URL('../supabase/migrations/20261024_registro_comun.sql', import.meta.url), 'utf8');
for (const t of ['log_settings', 'wellness_logs']) {
  assert.match(sql, new RegExp('create table if not exists public\\.' + t + ' \\('), t);
  assert.match(sql, new RegExp('alter table public\\.' + t + ' enable row level security'), t + ' con RLS');
}
assert.doesNotMatch(sql, /create policy log_settings_\w+ on public\.log_settings for (insert|update|delete|all)/, 'la configuración solo se escribe por set_log_settings');
assert.match(sql, /create policy wellness_logs_patient_all on public\.wellness_logs for all\s+using \(patient_id = public\.current_patient_id\(\)\) with check \(patient_id = public\.current_patient_id\(\)\)/);
assert.match(sql, /create policy wellness_logs_admin_select on public\.wellness_logs for select using \(public\.is_admin\(\)\)/, 'admin solo lee');
assert.match(sql, /unique \(patient_id, period, log_date\)/); assert.match(sql, /extract\(isodow from log_date\) = 1/);
assert.match(sql, /check \(mode = 'comun' or frequency = 'diaria'\)/, 'deportivo siempre diario');
for (const f of ['set_log_settings', 'coach_feed_v2']) {
  assert.match(sql, new RegExp('create or replace function public\\.' + f + '\\('), f);
  assert.match(sql, new RegExp('revoke all on function [^;]*public\\.' + f + '\\('), f + ' sin acceso anónimo');
}
assert.match(sql, /'semaforo' = any \(l\.scopes\)\) then v_by := 'profesional'/, 'un profesional configura solo con permiso semaforo vigente');
assert.match(sql, /insert into public\.access_log \(professional_id, patient_id, scope\)\s+select v_prof, l\.patient_id, 'semaforo'/, 'coach_feed_v2 registra el acceso');
assert.doesNotMatch(sql.slice(sql.indexOf('function public.coach_feed_v2')), /'notes'/, 'el profesional no ve notas libres');
// Textos de la hoja de vida iguales a settingsSummary()
for (const s of ['deportivo diario', 'general semanal', 'general diario', 'Sueño, fatiga, ánimo, dolor y carga de cada sesión.', 'Energía, sueño y estrés. Sin hábitos definidos.', "'Energía, sueño y estrés. Hábitos: '", "' Definido por '"]) assert.ok(sql.includes(s), 'SQL contiene ' + s);
assert.doesNotMatch(sql, /drop table|delete from|truncate/i, 'no borra datos');
// Cambio de frecuencia sin perder historia (semLogsComun en semaforo.js). Hoy: martes 2026-10-20.
const dias = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((x, i) => ({ period: 'dia', log_date: x, energy: 6, sleep_hours: 7, stress: 4, habits: { Agua: i < 4 ? 1 : 0 } }));
assert.equal(R.adherence(dias, 'semanal', '2026-10-20').done, 1, 'la semana con registros diarios cuenta en el semanal');
assert.deepEqual(R.habitStats(dias, ['Agua'], 'semanal', '2026-10-20')[0], { habit: 'Agua', done: 4, possible: 7, pct: 57 });
const mezcla = [{ period: 'semana', log_date: '2026-09-28', energy: 7, sleep_hours: 7, stress: 3, habits: { Agua: 7 } },
  { period: 'dia', log_date: '2026-10-19', energy: 6, sleep_hours: 7, stress: 4, habits: { Agua: 1 } }, { period: 'dia', log_date: '2026-10-20', energy: 5, sleep_hours: 6, stress: 4, habits: { Agua: 0 } }];
assert.equal(R.habitStats(mezcla, ['Agua'], 'diaria', '2026-10-20')[0].pct, 89, 'en diario, la semana registrada como semanal sigue contando (7/7 + 1/2)');
assert.equal(R.trendPointsFrom(mezcla, 'diaria', 'energy').length, 3, 'la tendencia diaria muestra también el semanal anterior');
assert.equal(R.adherence(mezcla, 'diaria', '2026-10-20').done, 2, 'la constancia diaria cuenta solo días registrados');
console.log('registro-comun: OK');
