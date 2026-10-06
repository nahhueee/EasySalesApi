# Diagnóstico de schema y datos (Fase 3.0)

Herramientas de **solo lectura** para saber cómo están de verdad las bases de los clientes
antes de tocar nada del modelo de datos (FKs, índices, migration base unificada — Fase 3).
Ver `documentos/handoff_fase3_0_diagnostico_schema.md` para el contexto completo.

Nada de esto toca `src/`, crea migrations, ni corrige datos. Solo mide y reporta.

## 0. Prerrequisito

MySQL local corriendo, con las credenciales de `config.pc.json` (`config.db.host/user/password`).
`crear-referencia.js` necesita permiso para crear/borrar bases (normalmente alcanza con el
`root` local de desarrollo).

## 1. Restaurar un backup real (a mano, una vez por backup)

Los backups de AdminServer son `mysqldump` estándar. **Siempre** a una base con prefijo
`diag_` explícito — los dumps traen `DROP TABLE IF EXISTS` y **no** traen `USE`, así que
restaurar sin nombrar la base (o nombrando `dbeasysales`) pisa la base de desarrollo:

```
mysql -u root -p -e "CREATE DATABASE diag_cliente_a"
mysql -u root -p diag_cliente_a < backup_cliente_a.sql
```

Repetir por cada backup (`diag_cliente_b`, `diag_cliente_c`, ...).

Los backups `.sql` y los informes generados **no se suben a git** (tienen datos de
clientes) — por eso `scripts/diagnostico/informes/` está en `.gitignore`.

## 2. Crear la base de referencia (una vez, o cuando cambie el schema)

`diag_referencia` representa una instalación **nueva de hoy**: corre
`src/db/script-bootstrap.sql` y encima `knex.migrate.latest()` con las 45 migrations de
`src/db/tasks`. Sirve de punto de comparación para el check C2.

```
node scripts/diagnostico/crear-referencia.js
```

Si una migration falla acá, **es un hallazgo** (bootstrap y migrations ya no coinciden hoy) —
el script no la "arregla", se frena y hay que reportarlo.

## 3. Diagnosticar cada base restaurada

```
node scripts/diagnostico/diagnosticar.js --db diag_cliente_a --ref diag_referencia --dump backup_cliente_a.sql
```

- `--db` (obligatorio): la base a analizar. Tiene que empezar con `diag_` — el script se
  niega a correr sobre cualquier otra cosa (probado incluso contra `dbeasysales`).
- `--ref` (opcional): `diag_referencia`, para el check C2 (deriva de schema). Sin esto, C2 se
  omite.
- `--dump` (opcional): la ruta al `.sql` original, para leer la versión de MySQL del cliente
  del header de `mysqldump` (las primeras 10 líneas). El MySQL local no representa al del
  cliente.

El informe queda en `scripts/diagnostico/informes/<db>_<YYYYMMDD>.md`. Si falta una tabla
(backup viejo sin `proveedores`, por ejemplo) el informe se genera igual — es un hallazgo,
no un crash.

## 4. Leer el informe

El `## Resumen` de arriba de todo se puede leer en 30 segundos: cuenta hallazgos críticos,
hallazgos y errores, y da el estado (`OK` / `HALLAZGO` / `ERROR`) de cada check C1 a C10.
El detalle de cada check está más abajo, en su propia sección.

**Nunca hay datos de clientes en el informe** — solo conteos, tipos, nombres de tabla/columna
e IDs numéricos (hasta 20 IDs de ejemplo por relación, en C5). Antes de pasarle el informe a
nadie fuera de este flujo, revisarlo una vez a mano.

## Qué mide cada check

| Check | Qué mide |
|---|---|
| C1 | Versión de MySQL, motor/collation/tamaño por tabla. MyISAM es hallazgo crítico (ignora FKs sin avisar). |
| C2 | Diferencias de schema contra `diag_referencia` (tablas, columnas, índices, FKs). Requiere `--ref`. |
| C3 | Estado de `knex_migrations`: qué migrations faltan o sobran, antigüedad aproximada de la instalación. |
| C4 | Para cada relación de `relaciones.js`: ¿el tipo de la columna hija coincide con la PK del padre? (si no, una FK real fallaría). También lista columnas `id*` que no están en `relaciones.js` ("relación no clasificada"). |
| C5 | Para cada relación: cuántos NULL, cuántos = 0, cuántos huérfanos (con hasta 20 IDs de ejemplo). |
| C6 | Registros especiales: producto VARIOS (id 1), tipo de pago EFECTIVO (id 1), cliente CONSUMIDOR FINAL (id 1, solo sí/no), cargos 1-3. |
| C7 | Códigos de producto duplicados (entre activos) y documentos de cliente duplicados. Solo conteos. |
| C8 | Índices del conjunto mínimo de `architecture.md` §12.2. |
| C9 | Pre-conciliación de caja: NULL/0 en `ventas.total`, diferencia entre `cajas.ventas` y la suma real por caja finalizada. Solo mide — qué debería ir en `cajas.ventas` es una decisión de negocio pendiente (3.4). |
| C10 | Stock: productos con cantidad negativa, decimales fuera de KG, `soloPrecio` inconsistente, volumen de `ventas_detalle` por año. |

## Archivos

- `relaciones.js`: la lista declarativa de relaciones (legacy sin FK, con FK ya declarada por
  migration, de auditoría sin FK por diseño, y polimórficas). Reusable en Fase 3.5.
- `crear-referencia.js`: construye `diag_referencia` desde cero.
- `diagnosticar.js`: corre los checks C1-C10 y escribe el informe.
