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
- Falta: lectura automática de PDF (los valores se anotan a mano). El archivo para el profesional quedó en "Adjuntos" (abajo).

Módulo 5b, Nutrición (rama `feat/nutricion`; migración `20261027_nutricion.sql` aplicada y probada):
- `assets/nutricion.js` + `tests/nutricion.test.mjs`: pestaña "Nutrición". Plan por comida (1 a 8: nombre, hora, qué comer) más indicaciones; base de 4 comidas para partir. Registro por comida: Cumplí / Parcial / No, hasta 7 días atrás (tocar de nuevo borra). Adherencia 7/28 días: % cumplido de lo registrado (parcial = ½) y constancia aparte (lo no registrado no es incumplido), por comida y gráfico diario. Peso y composición se leen de Medidas (`state.measurements`), sin duplicar.
- Tablas `nutrition_plans` (cada cambio es una versión nueva; vigente = la última con `valid_from` <= día, en fecha de Chile) y `meal_logs` (la persona escribe por RLS, solo sobre un plan propio y dentro de 7 días; admin lee).
- `set_nutrition_plan(p_patient, p_meals, p_notes)`: persona, admin o profesional con vínculo activo y scope `nutricion`; deja entrada `plan` / scope `nutricion` en la bitácora con lo que cambió (igual a `planJournal()`). `patient_nutricion(p_patient)`: plan, registros 90 días y peso/composición 1 año, con registro en `access_log`.
- Falta: pantalla del profesional (`SCOPES.nutricion.live` sigue en false). Hoy no hay profesionales con cuenta en la base: el camino del profesional se probó con uno temporal dentro de la transacción.

Ficha del profesional (rama `feat/ficha-profesional`; migración `20261028_ficha_profesional.sql` aplicada y probada):
- `assets/ficha-profesional.js` + `tests/ficha-profesional.test.mjs`: en `equipo.html`, hoja lateral por persona con una pestaña por permiso (Lesiones, Exámenes, Nutrición). Reutiliza los núcleos de `lesiones.js`, `examenes.js` y `nutricion.js` (mismas reglas que ve la persona). Cada sección se carga recién al abrirla con `patient_lesiones` / `patient_examenes` / `patient_nutricion` (registran el acceso). Con permiso `nutricion` el profesional edita el plan (`set_nutrition_plan`, queda a su nombre). Demo: `equipo.html?demo=1`.
- `my_linked_patients()`: nombre y permisos de cada vínculo activo, sin datos de salud (no registra acceso). Botón "Ver ficha" en la fila del panel (hook en `panel-coach.js`) y lista "Otras personas" para quienes dieron ficha pero no semáforo.
- `SCOPES[].live` en `mi-equipo.js`: semaforo, lesiones, examenes y nutricion. El profesional abre el archivo del examen con "Ver archivo" (ver "Adjuntos").

Caso: conversación del equipo (rama `feat/caso-equipo`; migración `20261029_caso_equipo.sql` aplicada y probada):
- `assets/caso.js` + `tests/caso.test.mjs`: hilos por persona con tema (general, semáforo, lesiones, exámenes, nutrición, salud mental, ciclo), enlace opcional a una lesión o examen, destinatarios ("el equipo y la persona", "solo profesionales", "solo a quienes elija"), menciones, acuses de lectura, editar (versión nueva, la anterior visible), retirar (oculta el texto, la fila queda) y pasar a la hoja de vida como nota o consulta (después no se edita ni se retira).
- Permiso nuevo `equipo` en `care_links` (`SCOPES` en `mi-equipo.js`). Un profesional lee un mensaje solo si va dirigido a él y hoy tiene `equipo` + el permiso del tema; `case_recipients` guarda quién podía leerlo al enviarlo.
- Decisiones de Diego: la persona ve completo lo dirigido a ella; de lo que es solo entre profesionales ve que existe (fecha, quién, tema), sin contenido ni título; lo que pasa a la hoja de vida siempre lo ve. El admin no lee estas tablas (RLS sin políticas). La persona puede escribirle a un solo profesional. Sin correo: aviso por WhatsApp sin contenido.
- Funciones: `post_case_message`, `edit_case_message`, `retract_case_message`, `promote_case_message`, `case_feed(p_patient)` (registra acceso `equipo` y marca leído), `my_case_feed()`, `my_case_inbox()` (sin contenido, no registra acceso), `my_case_unread()`.
- Pantallas: pestaña "Caso" en la ficha del profesional (primera), bandeja "Mensajes del equipo" en el panel (hook en `panel-coach.js`), tarjeta "Conversación con mi equipo" en "Mi equipo" (hook en `mi-equipo.js`). Demo: `equipo.html?demo=1` (Matías) y `rueda_final.html?demo=1`.
- Falta (fase 3): transcripción de audio, correo, y que la persona enlace hilos a sus lesiones o exámenes. El texto de consentimiento no cambió de versión: el permiso se describe en `{{DATOS}}`; va a la revisión legal.

Adjuntos (rama `feat/adjuntos`; migración `20261031_adjuntos.sql` aplicada y probada):
- Sin Edge Function (decisión técnica): `open_case_file(p_id)` y `open_document_file(p_doc)` revisan el permiso, registran el acceso del profesional en `access_log` (`equipo` o `examenes`) y dejan un permiso de 2 minutos en `file_grants` para ese archivo y ese usuario. Las políticas de storage `caso_granted_select` y `documentos_granted_select` lo exigen; la app firma una URL de 5 minutos.
- Caso: hasta 5 archivos por mensaje (PDF o imagen, 10 MB; `FILE_TYPES`, `MAX_FILES` en `caso.js`, sincronizados con el bucket). Bucket privado `caso`, ruta `<patient_id>/<auth.uid()>/<aleatorio>.<ext>` (sin el nombre original). Nadie lee el bucket directo, tampoco admin ni la persona. Se envía con `post_case_message_files` (mismo `post_case_message` + `case_attachments` en una transacción). Los adjuntos los abren las mismas personas que leen el mensaje; retirado = sin adjuntos; editar los copia a la versión nueva. Si el envío falla, quien subió borra lo no enviado (`caso_delete_unsent`). Demo: adjunto de ejemplo en el hilo de la rodilla.
- Ficha del profesional: "Ver archivo" en cada examen con archivo.
- Probado en transacción con 4 profesionales temporales: subir a carpeta ajena, reusar ruta, ruta ajena y archivo inexistente se rechazan; sin permiso del tema, sin `equipo` o sin `examenes` no abre; la persona no abre lo que es solo entre profesionales; retirado no abre; el bucket no se ve sin permiso vigente; accesos registrados. El borrado directo por SQL lo bloquea Supabase (desde la app va por la API de Storage, no probado con un usuario real).

Rediseño de experiencia (doc "Sizigia Lab — Diagnóstico de experiencia y propuesta de rediseño", https://claude.ai/artifact/LAaYYM1cwQuWPRBsk58ZM2): 13 pestañas pasan a 4 espacios (Hoy, Mi historia, Mi cuerpo, Mi equipo), un solo registro diario, ficha del profesional con portada y línea de tiempo. 4 fases.
- Fase 1, limpieza (rama `feat/limpieza-ux`, sin migración): Resumen en una columna (saludo, semáforo, "Hoy te toca", registro, tendencias, ciclo); se quitaron la fila de cifras, "Próximo control", el radar repetido (sigue en Mi Rueda), el upsell, la racha, las cifras repetidas de Historial y Mi Data, "Próximas sesiones" estimadas, el recordatorio de hitos, los bloqueos por plan/tiempo de Recursos y Medidas, `ROADMAP`, `TIERS`, `currentTier()` y los emojis. Constancia vive solo en Progreso. Letra ×1,15 (cuerpo 16 px, mínimo 12 px) en `rueda_final.html` y los módulos de la persona; pestañas en una fila deslizable en el celular; semáforo y alertas en tonos de la paleta (salvia `#55704F`, ocre `#B8862B`, ladrillo `#A13D2D`). Descargas `sizigia-*` en vez de `sobi-*`.
- Rueda apagada (rama `feat/sin-rueda`, decisión de Diego: estaba anclada a los programas de 3 y 6 meses): sin "Hoy te toca" en Resumen ni las pestañas Mi Rueda, Progreso e Historial; quedan 10 pestañas. "Composición corporal, inicio vs. ahora" pasó a Medidas. Las funciones de la Rueda y los check-ins guardados siguen en el código y en la base (para volver: agregar sus pestañas en `TABS` y `render()`); Mi Data sigue exportando ese historial. `admin.html` no se tocó.
- Fase 2, versión nueva (rama `feat/hoy-v2`, sin migración). Desde la rama `feat/v2-por-defecto` es la versión por defecto: `?v=1` o "Volver a la versión anterior" (Mi equipo > Mi registro y perfil) vuelven a la anterior y queda guardado en `localStorage` `sizigiaV2` = `0`; `?v=2` la reactiva. No es un `app.html` aparte: los módulos dependen de la sesión y el estado de `rueda_final.html`, así que se engancha con una línea al inicio de `render()` (`SizigiaHoy.render(app)`). Demo: `rueda_final.html?demo=1&v=2`.
  - `assets/hoy.js` + `tests/hoy.test.mjs`: 4 espacios con barra inferior (Hoy, Mi historia, Mi cuerpo, Mi equipo; flotante en escritorio) y sub-secciones que reutilizan las pantallas existentes (`SPACES`). Hoy: saludo y fecha, lectura del día en una frase (`reading()` desde el semáforo, con "¿Por qué este color?"), botón "Registrar mi día/semana" o "Ya registraste · Editar", 3 indicadores frente al promedio de 14 días (`indicator()`; el tercero es dolor si hay lesión abierta, ciclo si lo registra, si no ánimo o hábitos/estrés).
  - `assets/registro-diario.js` + `tests/registro-diario.test.mjs`: registro único paso a paso, respuestas a toques, sin valores por defecto en las escalas (precarga lo ya registrado). Deportivo: sueño, fatiga, ánimo, dolor (+zona), lesiones abiertas, entreno, ciclo, nota. General: sueño, energía, estrés, lesiones, hábitos, ciclo, nota (semanal sin lesiones ni ciclo). Guarda en las mismas tablas por funciones nuevas sin pantalla: `SizigiaRegistro.saveRow`, `SizigiaLesiones.savePainValue`, `SizigiaPersona.saveCycleRow`; `athlete_logs` directo (misma fila que `saveAthleteLog`).
  - Fase 3 hecha (ver abajo).
- Fase 3 (rama `feat/fase3`; migración `20261030_linea_tiempo.sql` aplicada y probada):
  - `assets/linea-tiempo.js` + `tests/linea-tiempo.test.mjs`: núcleo único de la hoja de vida para la persona y el profesional. Entradas de `journal_entries` y consultas en una lista por mes, con tema (scope), quién lo registró (`authorLabel`, según quién mira) y filtros por tema y autor que solo aparecen si sirven.
  - Persona (`?v=2`, Mi historia > Línea de tiempo; también la pestaña "Mi hoja de vida" de la versión anterior): `persona.bitacoraTab()` usa el núcleo; "Agregar una nota" queda plegado. Demo: la hoja de vida se siembra una vez aunque otro módulo ya haya creado la lista.
  - Hoy suma "Lo que viene" (`upcoming()`, máx. 3): mensajes sin leer (`my_case_unread`, sin contenido), comidas del plan de hoy por registrar (`SizigiaNutricion.todaySummary()`) y perfil incompleto, cada uno con su destino.
  - Ficha del profesional: pestaña Portada primero si tiene algún tema de la hoja de vida (`TIMELINE_SCOPES`). Semáforo y constancia de la fila del panel (`SizigiaCoach.rowFor`), lesiones abiertas, exámenes fuera de rango y la línea de tiempo con autor y rol. Lesiones y exámenes se piden con sus RPC de siempre y se reusan en sus pestañas.
  - `patient_timeline(p_patient)`: única puerta del profesional a `journal_entries` (sigue sin política RLS para profesionales). Solo vínculo activo y solo los temas autorizados (salud mental y ciclo solo con su permiso); nombre y rol del autor; una fila en `access_log` por tema expuesto. Probada en transacción: sin vínculo, solo semáforo y revocado se rechazan; con General + Lesiones no ve salud mental ni ciclo y deja 2 accesos.
  - Falta: guía de Recursos según la lectura, consultas futuras reales en "Lo que viene" (no hay agenda en la base) y, cuando la versión anterior ya no se use, retirar sus pestañas de `rueda_final.html`.

Organizaciones (rama `feat/organizaciones`; migración `20261101_organizaciones.sql` aplicada y probada):
- Tablas `organizations` y `org_members` (correo, como `admins`). `patients.org_id` y `templates.org_id` son obligatorios; `professionals.created_by_org` indica qué organización lo registró. Lo que había quedó en "Medicina Humana" (slug `medicina-humana`).
- Permisos: `is_org_admin(org)`, `is_patient_admin(patient)` y `is_patient_admin_path(carpeta)` (storage). Todas las políticas de admin las usan; ninguna usa ya `is_admin()`, que solo significa "admin de alguna organización" (puerta de `admin.html`). `admins` pasa a admin de plataforma (`is_platform_admin()`): crea organizaciones (`create_organization(nombre, slug, correo)`, también desde SQL Editor) y edita el consentimiento, pero no lee personas.
- Al insertar persona, plantilla o profesional, un trigger pone la organización del admin (si es admin de varias, hay que indicarla). Nadie cambia de organización desde la app; desde SQL Editor sí. `admin.html` no cambió.
- Profesionales globales: el admin ve los que registró su organización o los que tienen vínculo con personas suyas, y edita o borra solo los suyos que no tengan vínculos fuera.
- El correo de una persona es único en toda la plataforma (`patients_email_unique`): una persona en dos organizaciones no se puede representar hoy.
- Regla 4: el admin ya no lee `journal_entries` de salud mental ni ciclo, ni escribe directo en la bitácora.
- Corregido de paso: `save_document`, `delete_document` y `case_own_message` dejaban pasar a quien no es paciente (`current_patient_id()` null hacía que `not (false or null)` no lanzara el error). Un profesional podía crear o borrar documentos de cualquier persona y editar o retirar sus mensajes.
- Probado en transacción con un admin de otra organización y un profesional temporales: el admin de la otra organización ve 0 personas, registros, bitácora, documentos, archivos y plantillas de Medicina Humana; no da de alta, no edita, no borra ni mueve personas; las funciones con `p_patient` lo rechazan; no crea organizaciones ni se suma a otra. Medicina Humana no ve a la persona de la otra organización.
- Las organizaciones nuevas parten sin plantillas.

Pruebas: este PC no tiene Node. Se corren en Edge headless con un perfil aparte (`--user-data-dir`), cargando el módulo con `module={exports:{}}`, un shim de `assert` y uno de `require` (panel-coach usa semaforo y registro-comun). Edge solo entrega `--dump-dom` con `Start-Process -RedirectStandardOutput`. Para ver páginas en el navegador integrado hace falta un servidor local (sin Node: un `HttpListener` de PowerShell). Si se instala Node, basta `node tests/*.test.mjs`. Más rápido: con el servidor local abierto en el navegador integrado, correr todas las pruebas desde la herramienta de JavaScript (XHR síncrono para `require` y `readFileSync`, `new Function` con `module`, quitar las líneas `import` y reemplazar `import.meta.url` por la URL del test).

## Módulos por construir (en este orden)
Cada uno: `assets/<modulo>.js` + migración con RLS + `tests/<modulo>.test.mjs` + pestaña en la app de la persona vía hook mínimo. Sirven a coach con clientes comunes, a Manuel y al deportista.
1. ~~**Lesiones y rehabilitación**~~ (hecho, ver arriba; viene de Matías Lacroix): historial por lesión (fecha, zona, EVA, tratante, estado, alta, notas), dolor diario enlazado a la lesión abierta, cada cambio genera entrada en `journal_entries` (kind 'lesion'). Scope de permiso: `lesiones`.
2. ~~**Mi equipo y permisos**~~ (hecho, ver arriba): la persona invita coach/nutri/psicólogo/médico, permiso por tipo de dato (semaforo, ciclo, lesiones, nutricion, examenes, salud_mental, bitacora), revocable, con registro de accesos visible (`care_links`, `grant_care_link`, `revoke_care_link`, `access_log` ya existen en backend; falta la pantalla).
3. ~~**Registro de persona común**~~ (hecho, ver arriba): versión sin RPE (energía, sueño, estrés, hábitos), diario o semanal según el coach.
4. ~~**Panel del coach**~~ (hecho, ver arriba). Falta: plantillas propias del coach, notas del coach por persona, y que `admin.html` calcule el semáforo del registro general.
5. ~~**Exámenes y documentos**~~ y ~~**Nutrición**~~ (hechos, ver arriba).
~~Vista del profesional para lesiones, exámenes y nutrición~~ (hecha, ver "Ficha del profesional").
6. **Caso, conversación del equipo**: fases 1 y 2 (adjuntos) hechas (ver "Caso" y "Adjuntos"). Fase 3: transcripción de consultas y correo.

## Deuda a retirar
- Código de la Rueda apagado dentro de `rueda_final.html` (`renderRueda`, `renderProgreso`, `renderHistorial`, `buildDayCard`, pilares) y los campos `programMonths` / `tier_plan` de `patients`: borrar cuando la carcasa nueva reemplace a `rueda_final.html`, si la Rueda no vuelve.
- Probar en navegador: la demo es `rueda_final.html?demo=1` (sin red, usa semilla). Para probar sin Supabase, stub de `window.supabase.createClient`.

## Bloqueantes antes de vender a terceros
1. ~~Organizaciones + RLS multi-tenant~~ (hecho, ver "Organizaciones"). Falta el registro de accesos del admin: sigue leyendo por RLS directo, sin `access_log`.
2. Revisión legal del texto de consentimiento (borrador).
3. Manuel debe validar los umbrales de `SEM_RULES`.
4. Apple Health requiere app nativa o agregador; WHOOP API exige aprobación sobre 10 usuarios.

## Cómo trabajar con git aquí
Si hay `.git/*.lock` huérfanos, renombrarlos a `.git/stale-*`. Commits con autor Diego Díaz.
Diego prefiere que Claude haga todo: aplicar la migración en Supabase (SQL Editor en el navegador integrado, con prueba en transacción que se deshace), commit, `git push` y crear el PR en GitHub (navegador integrado; `gh` no está instalado). El merge a `main` lo aprueba Diego (publica en producción). Después: verificar en `sizigialab.cl/rueda_final.html?demo=1`.
SQL Editor: escribir el SQL en una sola línea, sin comentarios y sin barras invertidas (el editor autocompleta al presionar Enter y el teclado simulado altera `\`); verificar el largo leyendo el modelo de Monaco antes de Run.
Más rápido: cargar el SQL con `monaco.editor.getModels()[0].setValue(...)` desde la herramienta de JavaScript del navegador (Ctrl+V no funciona). Para una migración larga: push de la rama y `fetch('https://raw.githubusercontent.com/ddiegodiaz-sizigia/sobi-sizigialab-web/<commit>/supabase/migrations/<archivo>')` desde la pestaña de Supabase (el repo es público; localhost está bloqueado), comparando el largo con el archivo. Prueba en transacción: un bloque `do` que termina en `raise exception` con los resultados se deshace solo; después, contar que no quedan filas de prueba.
