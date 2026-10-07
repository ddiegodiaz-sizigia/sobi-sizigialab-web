# Sizigia Lab — estado técnico (actualizado 07-10-2026)

Reemplaza la versión del 17-08-2026, que describía Netlify y no incluía el panel admin.

## Infraestructura
- Hosting: Cloudflare, sitio estático (`wrangler.jsonc`), dominio `sizigialab.cl`. Repo en GitHub, rama `main`.
- Supabase: proyecto `rueda-sobi`, organización "Medicina Humana", cuenta ddiegodiaz@gmail.com (no la de Lemu). Auth por magic link.
- Un workflow de GitHub (`supabase-keepalive.yml`) hace ping cada 2 días para que el plan Free no se pause.

## Tablas conocidas por el código
`patients`, `checkins` (ratings jsonb), `measurements` (peso, % grasa, masa muscular, FC reposo, sueño, HRV, carga, cargados a mano), `transcripts`, `templates`, `program_days`, `patient_exams` (fecha de examen), `patient_logins`, `admins`.
Nuevas: `athlete_logs` (registro deportivo diario autoinformado), `professionals`, `care_links` (permiso revocable del atleta a un profesional), `access_log` (quién consultó qué).
RPC: `is_admin()`, `claim_professional()`, `list_professionals()`, `grant_care_link()`, `revoke_care_link()`, `coach_feed()`.

## Qué existe
- App de paciente: check-in semanal por tipo de día, rueda de pilares, medidas, historial, sesiones (solo lectura), descarga de datos, modo demo.
- Panel admin: pacientes y programa de mensajes, plantillas, bitácora, Estado (adherencia 7 días, examen, control, último acceso), ficha con resumen de señales.
- Rama `feat/consent-v2`: consentimiento versionado. El atleta lee el texto vigente y marca una casilla (sin marcar por defecto) antes de conceder; se guarda versión y fecha, y el historial de permisos se conserva. Migración `20261009_consent_texts.sql` (cambia la firma de `grant_care_link`).
- Rama `feat/roles-v0`: profesionales dados de alta por el admin, el atleta concede o retira acceso al semáforo en Mi Data, vista `equipo.html`, registro de accesos visible para el atleta. 43 pruebas de políticas en `supabase/tests`.
- Rama `feat/atleta-semaforo`: registro deportivo de menos de 30 s y semáforo de disponibilidad con reglas explicables (umbrales en `SEM_RULES` de `admin.html`, pendientes de validación médica).

## Qué NO existe
- Integración con WHOOP u otro wearable.
- Permisos granulares más allá de `semaforo`. Todo admin sigue leyendo a todos los pacientes, sin registro de acceso.
- Check-ins por WhatsApp. El admin solo arma links `wa.me` con plantillas.
- Multi-organización.

## Riesgos
- Las políticas RLS anteriores a octubre 2026 no están en el repo; no se pueden auditar desde el código.
- Los datos del semáforo son autoinformados. Sin adherencia no hay semáforo.
- Archivos HTML grandes sin pruebas automáticas.
