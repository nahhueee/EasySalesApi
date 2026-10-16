# Pruebas de la Fase 3.1-B (migration base y fin de `script.sql`)

Migration: `src/db/tasks/20260101000000_schema_base.js`.
Handoff: `documentos/handoff_fase3_1b_migration_base.md` (§4).

> **Siempre sobre copias** en lo que toca bases `diag_*`. V7 a V9 son instalaciones reales.

## Ya corrido (MySQL 8.0.46, referencia = bootstrap + 49 migrations)

V1, V2 (+ diff directo de `SHOW CREATE TABLE`), V3, V4 (sintético), V5, V6, V10 (build) y V11. Detalle en la descripción del PR.

## Pendiente 1 — V4 con tus backups reales (A, B y C ya reconciliados por la 3.1-A)

Sobre las copias que dejó la 3.1-A (`diag_a_31`, `diag_b_31`, `diag_c_31`):

```
# antes: guardar conteo de filas y schema (el informe de diagnosticar.js sirve)
node scripts/diagnostico/diagnosticar.js --db diag_a_31 --ref diag_ref_nueva

node scripts/diagnostico/migrar.js --db diag_a_31
```

Esperado, por base:
- `Migrations pendientes antes de correr: 1` → `20260101000000_schema_base.js`.
- `Batch N — 1 migration(s) aplicadas` y **ningún** error (knex acepta una pendiente más vieja que las completadas).
- Conteo de filas y schema idénticos antes y después. Es un no-op: la guarda ve `ventas`.

Para `diag_ref_nueva`: `node scripts/diagnostico/crear-referencia.js --db diag_ref_nueva`.

## Pendiente 2 — V7 a V9: instalador (canary / VM Windows con MySQL + Node, sin base)

Antes: aplicar los cambios de los `.aip` (ver descripción del PR) y generar el instalador nuevo con
`npm run build:server-installer` (borrar antes `dist/src/db/script*.sql` si quedaron de builds viejos;
`dist/` no se limpia solo).

Log del paso: `%TEMP%\EasySales\setup-mysql-bootstrap.log`.

| # | Prueba | Esperado |
|---|---|---|
| V7 | Instalación limpia (MySQL + Node, **sin** `dbeasysales`) | Log: "La base 'dbeasysales' no existe… Corriendo migrations… creada y migrada correctamente". Server arriba; login ADMIN/1235; una venta de punta a punta. |
| V8 | Reinstalar encima de V7 | Log: "La base 'dbeasysales' ya existe. Se saltea…". Base intacta (mismos datos, incluida la venta de V7). |
| V9 | Instalación con la password de MySQL incorrecta | Error visible y log claro. **La base no queda creada.** |
| V9b | (extra) Que falle la migración **después** del CREATE: dejar en `server\config.pc.json` una password de DB distinta a la que usa el instalador | `knex migrate:latest` falla → log "Revirtiendo… Base 'dbeasysales' eliminada" → no queda base → se puede reintentar. |

Cosas a mirar en V7:
- `SetupDB` corre **antes** de `SetupPM2` (secuencias 5936 y 5938 en `Easy Sales Servidor.aip`).
- Si V9 / V9b dejan la instalación "como exitosa" a pesar del error, revisar en Advanced Installer si la
  custom action `SetupDB` tiene activado ignorar el código de salida (su `Type` es 1601 y el de `SetupPM2` es 1089:
  difieren en el bit 0x200).

## Deploy (lo decidís vos)

1. Release del backend (updater): en bases existentes, la base corre como no-op. Canary, después producción.
2. Instalador nuevo: **después** del paso 1 y cuando V7 a V9 estén OK.
3. Hasta que este PR esté mergeado, toda migration nueva se sigue copiando al bootstrap. Después, nunca más.
