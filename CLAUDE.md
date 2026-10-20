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

## Pendiente conocido
Organizaciones y RLS multi-tenant (bloquea coaches ajenos), pantalla de bitácora, pantalla de ciclo, conectar `assets/trend-chart.js` a la pantalla Hoy, retirar `tier_plan` de la app, revisión legal del consentimiento.
