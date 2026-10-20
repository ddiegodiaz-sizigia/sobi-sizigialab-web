# Sizigia Lab — plataforma (instrucciones para Claude Code)

Producto: bitácora (hoja de vida) de cada persona, con su equipo (coach, nutricionista, psicólogo, médico) y permisos por tipo de dato. Clientes: coaches con clientes comunes (volumen), Dr. Manuel Acuña con pacientes personales, alto rendimiento (credencial). Sin planes de 3/6 meses.

## Contexto
- Dueño: Diego Díaz. Cuenta personal ddiegodiaz@gmail.com. No mezclar con su trabajo en Lemu.
- Estilo: directo, sin relleno; marcar lo débil; traducir a impacto económico; decir el riesgo estructural.
- Plan y diagnóstico completos: ver ARQUITECTURA.md y el doc "Sizigia Lab — Propuesta de mejora".

## Reglas de código
1. Este repo vive en `C:\Dev`, nunca en OneDrive (OneDrive truncó archivos).
2. No agregar código nuevo a `rueda_final.html` ni `admin.html`. Módulos nuevos en `assets/`, con prueba en `tests/` (`node tests/*.test.mjs`).
3. Toda tabla nueva: migración idempotente en `supabase/migrations/` con RLS y prueba. Las migraciones se aplican a mano en Supabase > SQL Editor.
4. Datos de salud: ciclo y salud mental nunca los lee un admin por RLS directo; solo la persona o un profesional con permiso por función que registre el acceso.
5. Semáforo: informativo, reglas visibles (`assets/semaforo.js`), umbrales validados por Manuel. Nunca un veredicto clínico.
6. Copy público: no usar la palabra "SOBI"; usar Sizigia Lab o Medicina Humana.
7. Rama por tema (`feat/...`) y PR a `main`. Cloudflare despliega al hacer push a `main`. No pushear a `main` directo.

## Estado actual (2026-10-20)
Todas las migraciones del repo están aplicadas en Supabase (proyecto `emrlmvaelixpxrinzzzw`, "rueda-sobi").
Base (en `main`, PR #2 y #3):
- `assets/semaforo.js`: semáforo con explicación ("¿Por qué este color?").
- `assets/trend-chart.js`: gráficos con ventanas 7/14/30/60 y eje ajustado.
- `assets/persona.js`: pantalla de la persona (semáforo, tendencias, ciclo, perfil/sexo, pestaña "Mi hoja de vida"). Se conecta a `rueda_final.html` con `SizigiaPersona.*` (única edición permitida en ese archivo).
- Tablas: `cycle_logs`, `journal_entries`; RPC `set_my_profile`; `patients.sex`, `tracks_cycle`.
- Alta de paciente (admin.html) pide sexo; sin planes de 3/6 meses.

Módulo 1, Lesiones (en `main`, PR #4; migración `20261022_lesiones.sql`):
- `assets/lesiones.js` + `tests/lesiones.test.mjs`: historial por lesión, dolor diario (EVA) por lesión abierta con gráfico, alta/recaída, sugerencia desde el registro diario si coincide la zona. Pestaña "Lesiones" en `rueda_final.html`.
- Tablas `injuries`, `injury_pain_logs`; trigger `injuries_to_journal` escribe cada cambio en `journal_entries` (kind `lesion`, scope `lesiones`); el dolor diario no va a la bitácora. Profesional con permiso `lesiones` lee por `patient_lesiones(p_patient)` con registro en `access_log`.

Módulo 2, Mi equipo (en `main`, PR #5; migración `20261023_mi_equipo.sql`):
- `assets/mi-equipo.js` + `tests/mi-equipo.test.mjs`: pestaña "Mi equipo". Invitar por correo, permisos por tipo de dato (7 scopes), consentimiento `v3-borrador` con la lista exacta de datos (`{{DATOS}}`), cambiar/retirar con historial, registro de accesos agrupado por día. Reemplazó la tarjeta antigua de "Mi Data" (se borraron ~90 líneas de `rueda_final.html`).
- RPC nuevas: `invite_professional`, `my_care_team`, `my_access_log`; `grant_care_link` exige al menos un scope.
- `SCOPES[].live` en `mi-equipo.js` marca qué dato ya ve el profesional en `equipo.html`: hoy solo `semaforo`. Actualizarlo cuando cada módulo tenga su vista del profesional (`lesiones` ya tiene RPC, falta pantalla).
- No hay correo automático de invitación: la persona avisa por WhatsApp (link a `equipo.html`, el profesional entra con magic link y `claim_professional`).

Módulo 3, Registro de persona común (rama `feat/registro-comun`; migración `20261024_registro_comun.sql` aplicada y probada):
- `assets/registro-comun.js` + `tests/registro-comun.test.mjs`: energía, sueño (horas y calidad), estrés y hábitos (máx. 8), sin RPE ni minutos. Diario (hábito hecho sí/no) o semanal (días por hábito, 0-7; se guarda en el lunes). Constancia (7 días / 4 semanas) y % por hábito. Tarjeta en Resumen: hook `SizigiaRegistro.card(renderAthleteLogCard)`; con modo deportivo muestra la tarjeta de siempre más "Configurar mi registro".
- Convivencia: cada persona usa UN registro (`log_settings.mode`: `deportivo` por defecto, o `comun`). Sin fila = deportivo diario, nada cambia para quien ya registra. `persona.js` cambia semáforo y tendencias (energía, sueño, estrés, hábitos %) según el modo.
- Semáforo general en `assets/semaforo.js` (`SEM_RULES_COMUN`, `computeSemaforoComun`): solo amarillo/verde/gris (sin dolor ni carga no hay rojo); sueño < 6 h, promedio 3 registros < 6,5 h (solo diario), energía ≤ 3, estrés ≥ 8; gris si no hay registro en 2 días o de esta semana/la anterior. Los hábitos no cambian el color. Pendiente de validación por Manuel.
- Tablas `log_settings` (solo se escribe por `set_log_settings`: la persona, admin o profesional con vínculo activo y scope `semaforo`; cada cambio deja entrada `plan` en la bitácora) y `wellness_logs` (persona todo lo suyo, admin solo lee). `coach_feed_v2()` reemplaza a `coach_feed()` en `equipo.html`: devuelve modo, frecuencia y registros (sin notas) y registra un acceso por persona. `coach_feed()` queda por compatibilidad.
- Falta: `admin.html` sigue calculando el semáforo solo con `athlete_logs`: para personas en modo general muestra gris.

Módulo 4, Panel del coach (rama `feat/panel-coach`; migración `20261025_panel_coach.sql` aplicada y probada):
- `assets/panel-coach.js` + `tests/panel-coach.test.mjs`: `equipo.html` ahora es una lista compacta (30-80 personas) ordenada rojo > amarillo > sin datos > verde. Resumen por color (filtro con un clic), "con pendientes", constancia del grupo, búsqueda sin tildes y filtro por tipo de registro. Demo sin red: `equipo.html?demo=1`.
- Pendientes por persona: alerta (rojo/amarillo no contactado desde el último registro), sin registro (gris; no vuelve hasta 3 días después de contactar), constancia baja (< 50 %), sin hábitos (registro general).
- Mensajes por WhatsApp con 5 plantillas (`TEMPLATES`, sincronizadas con el check SQL): `wa.me/?text=` sin número, el coach elige el contacto; el teléfono de la persona no se expone. Al abrir WhatsApp o "Ya le escribí" se llama `mark_contacted` (tabla `coach_contacts`: quién, cuándo, plantilla; sin texto ni datos de salud) y los pendientes se limpian.
- El coach configura el registro de cada persona (`set_log_settings(p_patient, ...)`); queda en la bitácora con su nombre.
- `coach_feed_v2()` se redefinió para devolver `last_contact` (contacto de ese profesional).
- Cambiar diario <-> semanal no pierde historia (`semLogsComun` en `semaforo.js`, decisión de Diego): en semanal, cada semana sin registro semanal se arma con el promedio de sus días (hábitos = días cumplidos); en diario, las semanas sin días conservan su semanal como referencia para hábitos y tendencias, y el semáforo usa el semanal de esta semana o la anterior si no hay día vigente. La constancia diaria cuenta solo días. Nada se reescribe en la base.

Módulo 5a, Exámenes y documentos (rama `feat/examenes`; migración `20261026_examenes.sql` aplicada y probada):
- `assets/examenes.js` + `tests/examenes.test.mjs`: pestaña "Exámenes". Subir PDF o imagen (máx. 10 MB) al bucket privado `documentos` (ruta `<patient_id>/<fecha>-<aleatorio>.<ext>`, sin el nombre original), visor con URL firmada de 5 minutos, resultados por documento (catálogo de 20 marcadores u "Otro"), "Mis biomarcadores" con último valor, variación y gráfico. Acepta coma decimal.
- Fuera de rango compara con el rango del laboratorio que anota la persona; el catálogo sugiere un rango general editable por sexo (`BIOMARKERS`, pendiente de validación por Manuel). Informativo, sin veredicto.
- Tablas `documents` y `biomarker_results`: la persona lee lo suyo, admin lee todo; nadie escribe directo. Escritura solo por `save_document(p_patient, p_doc, p_results)` y `delete_document(p_id)` (persona o admin), que dejan entrada `examen` / scope `examenes` en la bitácora (texto en `document_journal_body`, igual a `journalText()`). Profesional con permiso `examenes` lee por `patient_examenes(p_patient)` con registro en `access_log` (sin el archivo).
- Falta: que el profesional vea el archivo (firmar la URL desde una Edge Function que registre el acceso), pantalla del profesional (`SCOPES.examenes.live` sigue en false), lectura automática de PDF (los valores se anotan a mano).

Pruebas: este PC no tiene Node. Se corren en Edge headless con un perfil aparte (`--user-data-dir`), cargando el módulo con `module={exports:{}}`, un shim de `assert` y uno de `require` (panel-coach usa semaforo y registro-comun). Edge solo entrega `--dump-dom` con `Start-Process -RedirectStandardOutput`. Para ver páginas en el navegador integrado hace falta un servidor local (sin Node: un `HttpListener` de PowerShell). Si se instala Node, basta `node tests/*.test.mjs`.

## Módulos por construir (en este orden)
Cada uno: `assets/<modulo>.js` + migración con RLS + `tests/<modulo>.test.mjs` + pestaña en la app de la persona vía hook mínimo. Sirven a coach con clientes comunes, a Manuel y al deportista.
1. ~~**Lesiones y rehabilitación**~~ (hecho, ver arriba; viene de Matías Lacroix): historial por lesión (fecha, zona, EVA, tratante, estado, alta, notas), dolor diario enlazado a la lesión abierta, cada cambio genera entrada en `journal_entries` (kind 'lesion'). Scope de permiso: `lesiones`.
2. ~~**Mi equipo y permisos**~~ (hecho, ver arriba): la persona invita coach/nutri/psicólogo/médico, permiso por tipo de dato (semaforo, ciclo, lesiones, nutricion, examenes, salud_mental, bitacora), revocable, con registro de accesos visible (`care_links`, `grant_care_link`, `revoke_care_link`, `access_log` ya existen en backend; falta la pantalla).
3. ~~**Registro de persona común**~~ (hecho, ver arriba): versión sin RPE (energía, sueño, estrés, hábitos), diario o semanal según el coach.
4. ~~**Panel del coach**~~ (hecho, ver arriba). Falta: plantillas propias del coach, notas del coach por persona, y que `admin.html` calcule el semáforo del registro general.
5. ~~**Exámenes y documentos**~~ (hecho, ver arriba) y **Nutrición** (plan por comida, adherencia, peso/composición).

## Deuda a retirar
- La app de la persona aún muestra residuos del cronograma de 6 meses: tarjeta "Próximo control · Mes 6", "Hoy te toca · Hábito Ancla", `programMonths`, `tier_plan` (tope de resumen de sesiones). Reemplazar por contenido basado en la bitácora.
- Probar en navegador: la demo es `rueda_final.html?demo=1` (sin red, usa semilla). Para probar sin Supabase, stub de `window.supabase.createClient`.

## Bloqueantes antes de vender a terceros
1. Organizaciones + RLS multi-tenant (hoy el admin lee a todos los pacientes sin registro de acceso).
2. Revisión legal del texto de consentimiento (borrador).
3. Manuel debe validar los umbrales de `SEM_RULES`.
4. Apple Health requiere app nativa o agregador; WHOOP API exige aprobación sobre 10 usuarios.

## Cómo trabajar con git aquí
Si hay `.git/*.lock` huérfanos, renombrarlos a `.git/stale-*`. Commits con autor Diego Díaz.
Diego prefiere que Claude haga todo: aplicar la migración en Supabase (SQL Editor en el navegador integrado, con prueba en transacción que se deshace), commit, `git push` y crear el PR en GitHub (navegador integrado; `gh` no está instalado). El merge a `main` lo aprueba Diego (publica en producción). Después: verificar en `sizigialab.cl/rueda_final.html?demo=1`.
SQL Editor: escribir el SQL en una sola línea, sin comentarios y sin barras invertidas (el editor autocompleta al presionar Enter y el teclado simulado altera `\`); verificar el largo leyendo el modelo de Monaco antes de Run.
Más rápido: cargar el SQL con `monaco.editor.getModels()[0].setValue(...)` desde la herramienta de JavaScript del navegador (Ctrl+V no funciona). Prueba en transacción: un bloque `do` que termina en `raise exception` con los resultados se deshace solo; después, contar que no quedan filas de prueba.
