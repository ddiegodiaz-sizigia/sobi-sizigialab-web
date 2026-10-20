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

## Estado actual (2026-10-20, rama feat/bitacora-base)
Hecho y en la rama (migraciones 20261020 y 20261021 ya aplicadas en Supabase):
- `assets/semaforo.js`: semáforo con explicación ("¿Por qué este color?").
- `assets/trend-chart.js`: gráficos con ventanas 7/14/30/60 y eje ajustado.
- `assets/persona.js`: pantalla de la persona (semáforo, tendencias, ciclo, perfil/sexo, pestaña "Mi hoja de vida"). Se conecta a `rueda_final.html` con `SizigiaPersona.*` (única edición permitida en ese archivo).
- Tablas: `cycle_logs`, `journal_entries`; RPC `set_my_profile`; `patients.sex`, `tracks_cycle`.
- Alta de paciente (admin.html) pide sexo; sin planes de 3/6 meses.

Módulo 1 hecho en rama `feat/lesiones` (migración `20261022_lesiones.sql` aplicada en Supabase el 2026-10-20 y probada con transacción que se deshace):
- `assets/lesiones.js` + `tests/lesiones.test.mjs`: historial por lesión, dolor diario (EVA) por lesión abierta con gráfico, alta/recaída, sugerencia desde el registro diario si coincide la zona. Pestaña "Lesiones" en `rueda_final.html`.
- Tablas `injuries`, `injury_pain_logs`; trigger `injuries_to_journal` escribe cada cambio en `journal_entries` (kind `lesion`, scope `lesiones`); el dolor diario no va a la bitácora. Profesional con permiso `lesiones` lee por `patient_lesiones(p_patient)` con registro en `access_log`.
- Sin Node en el PC de Diego: las pruebas se verificaron con Edge headless. Instalar Node para `node tests/*.test.mjs`.

## Módulos por construir (en este orden)
Cada uno: `assets/<modulo>.js` + migración con RLS + `tests/<modulo>.test.mjs` + pestaña en la app de la persona vía hook mínimo. Sirven a coach con clientes comunes, a Manuel y al deportista.
1. ~~**Lesiones y rehabilitación**~~ (hecho, ver arriba; viene de Matías Lacroix): historial por lesión (fecha, zona, EVA, tratante, estado, alta, notas), dolor diario enlazado a la lesión abierta, cada cambio genera entrada en `journal_entries` (kind 'lesion'). Scope de permiso: `lesiones`.
2. **Mi equipo y permisos**: la persona invita coach/nutri/psicólogo/médico, permiso por tipo de dato (semaforo, ciclo, lesiones, nutricion, examenes, salud_mental, bitacora), revocable, con registro de accesos visible (`care_links`, `grant_care_link`, `revoke_care_link`, `access_log` ya existen en backend; falta la pantalla).
3. **Registro de persona común**: versión sin RPE (energía, sueño, estrés, hábitos), diario o semanal según el coach.
4. **Panel del coach** (`equipo.html`): 30–80 clientes, semáforo, adherencia, pendientes, filtros, mensajes con plantilla por WhatsApp.
5. **Exámenes y documentos** (subida, visor, biomarcadores, entrada automática en la bitácora) y **Nutrición** (plan por comida, adherencia, peso/composición).

## Deuda a retirar
- La app de la persona aún muestra residuos del cronograma de 6 meses: tarjeta "Próximo control · Mes 6", "Hoy te toca · Hábito Ancla", `programMonths`, `tier_plan` (tope de resumen de sesiones). Reemplazar por contenido basado en la bitácora.
- Probar en navegador: la demo es `rueda_final.html?demo=1` (sin red, usa semilla). Para probar sin Supabase, stub de `window.supabase.createClient`.

## Bloqueantes antes de vender a terceros
1. Organizaciones + RLS multi-tenant (hoy el admin lee a todos los pacientes sin registro de acceso).
2. Revisión legal del texto de consentimiento (borrador).
3. Manuel debe validar los umbrales de `SEM_RULES`.
4. Apple Health requiere app nativa o agregador; WHOOP API exige aprobación sobre 10 usuarios.

## Cómo trabajar con git aquí
Si hay `.git/*.lock` huérfanos, renombrarlos a `.git/stale-*`. Commits con autor Diego Díaz. Flujo: commit en la rama, Diego hace Push origin en GitHub Desktop, PR a `main`, merge, Ctrl+Shift+R en `sizigialab.cl/rueda_final.html?demo=1`.
