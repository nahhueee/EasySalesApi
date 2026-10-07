# Pruebas de la Fase 3.1-A (reconciliar schema)

Migration: `src/db/tasks/20261007143500_reconciliar_schema_fase3.js`.
Handoff: `documentos/handoff_fase3_1a_reconciliar_schema.md` (§5).

> **Siempre sobre copias.** Nunca contra `dbeasysales` ni contra las bases `diag_*` originales del
> diagnóstico 3.0 (son el "antes"). Todos los scripts se niegan a correr si la base no empieza con `diag_`.

## 0. Preparación (una vez por backup)

Restaurar **dos copias** de cada backup, con prefijo `diag_`. La segunda sirve para demostrar que
"cortar a la mitad y reintentar" (V3) llega al mismo schema que una migración limpia (V1).

```
mysql -u root -p -e "CREATE DATABASE diag_a_31"
mysql -u root -p diag_a_31  < backup_cliente_a.sql

mysql -u root -p -e "CREATE DATABASE diag_a_31b"
mysql -u root -p diag_a_31b < backup_cliente_a.sql
```

Lo mismo para B (`diag_b_31`, `diag_b_31b`) y C (`diag_c_31`, `diag_c_31b`). Los dumps no traen `USE`:
sin nombrar la base en el comando pisan lo que tengas.

## 1. V1–V4 + criterios #3/#4: un comando por base

```
# 1) la copia "b": migración limpia, sin el corte de V3
node scripts/diagnostico/validar-3-1a.js --db diag_a_31b --sin-v3

# 2) la copia principal: V3 (corte después del paso 2 + reintento), V1, V2, V4,
#    y comparación del schema final contra la copia "b"
node scripts/diagnostico/validar-3-1a.js --db diag_a_31 --comparar-con diag_a_31b
```

Qué hace cada una (ver el encabezado de `validar-3-1a.js`):

| Prueba | Qué verifica |
|---|---|
| V3a / V3b | el error provocado después del paso 2 hace fallar la migration y **no** queda registrada; el reintento termina OK |
| V1 | la migration termina OK. **Hay que mirar los avisos** que imprime (lista abajo) |
| A1 | las 14 columnas hija quedaron con el tipo del padre (o salteadas con aviso) |
| A2 | criterio #4: `NULL/NOT NULL`, `DEFAULT`, PK y `EXTRA` de esas 14 columnas se preservaron (`ventas_factura.idVenta`, `ventas_pago.idVenta` siguen `NOT NULL` y PK; `productos.idCategoria` conserva su default) |
| A3 / A4 / A5 | índices §12.2, FKs declaradas y deriva ampliada presentes (o salteadas con aviso) |
| A6 | ningún conteo de filas cambió: la migration no toca datos |
| V2 | borra su registro de `knex_migrations` y la vuelve a correr: schema idéntico |
| V4 | `down` y `up` de nuevo: sin errores y schema idéntico |
| V3c | el schema final es idéntico al de la copia "b" (el corte+reintento converge) |

Sale con código 2 si algo falla. El informe queda en `informes/validacion_3_1a_<db>.md`.

## 2. V5 — instalación nueva

```
node scripts/diagnostico/crear-referencia.js
```

Bootstrap + **todas** las migrations (incluida esta) sobre `diag_referencia`. Tiene que terminar OK.
En la base de referencia nueva, la migration restaura 3 FKs que el bootstrap hacía perder:
`cajas_movimientos.idProveedorMovimiento`, `proveedor_cuenta_movimientos.idProveedor` y
`ventas_pagos_detalle.idVenta`.

## 3. V6 — diagnóstico de cada copia migrada

```
node scripts/diagnostico/diagnosticar.js --db diag_a_31 --ref diag_referencia
node scripts/diagnostico/diagnosticar.js --db diag_b_31 --ref diag_referencia
node scripts/diagnostico/diagnosticar.js --db diag_c_31 --ref diag_referencia
node scripts/diagnostico/diagnosticar.js --db diag_referencia
```

Esperado (handoff §5):

- **C2:** solo las diferencias toleradas de §4.4 (collation `latin1` en B; `ventas_pago.digital/efectivo/idPago`;
  `ventas.obsBaja` con default `''`; `ventas_entrega.fecha` `NOT NULL`; `productos.idCategoria` con default `NULL`;
  `knex_migrations.migration_time`).
- **C4:** 0 desajustes de tipo en las 14 relaciones (`usuarios_movimientos.idUsuario` es informativo: sin FK por diseño).
- **C8:** 0 índices faltantes.
- **C11 (nueva sección de FKs):** las 26 de la migration presentes en las 4 bases. Si alguna falta, tiene que
  haber un aviso en V1 que explique por qué se salteó.

Los informes quedan en `informes/` (fuera de git). **Adjuntar los 4 al PR.**

## 4. V7 — humo con la app (manual)

Apuntar la app a `diag_a_31` (migrada) y probar, comparando con el comportamiento de antes:

- [ ] abrir caja
- [ ] venta de contado
- [ ] venta en cuenta corriente
- [ ] cobro de fiado
- [ ] anular una venta
- [ ] cerrar caja
- [ ] alta y baja de producto
- [ ] alta y baja de cliente (incluye: no se puede dar de baja un cliente con saldo)
- [ ] borrar una venta con pagos (`ventas_pagos_detalle` ahora tiene FK: el borrado del hijo va primero, ya verificado en el código)

## 5. Cómo leer los avisos de V1

Cada aviso significa que **un paso se salteó** (R2). Como knex marca la migration como aplicada igual,
**no se reintenta sola**: se resuelve en la limpieza de huérfanos (3.5) reusando `helpers` de esta migration.

| Aviso | Qué pasó | Qué hacer |
|---|---|---|
| `…: N fila(s) con valor negativo; no entran en int unsigned` | la columna no se alineó | revisar por qué hay ids negativos |
| `FK …: N fila(s) huérfana(s)` | la FK no se creó | resolver en 3.5 (recrear el padre dado de baja) |
| `…: participa en una FK existente` | no se puede cambiar el tipo sin tirar la FK | analizar el caso a mano |
| `…: MySQL rechazó el cambio (ER_…)` | error determinístico de MySQL | ver el código de error en el aviso |

En el comercio los avisos quedan en `updater/actualizaciones.log` (`fase=migracion | modulo=reconciliar_schema_fase3`),
porque el updater descarta la salida estándar de `migrate:latest` cuando termina bien. En las pruebas con
`migrar.js` / `validar-3-1a.js` quedan en `informes/*_avisos.log`.

## 6. Antes de mergear

- [ ] `git diff main --stat`: solo `src/db/tasks/20261007143500_reconciliar_schema_fase3.js` y `scripts/diagnostico/**`.
- [ ] `grep -nEi "\b(update|insert|charset|collate)\b" src/db/tasks/20261007143500_reconciliar_schema_fase3.js` sin resultados
      (`ON DELETE` de las cláusulas de FK es lo único con "delete").
- [ ] Informes de V6 adjuntos al PR.

## 7. Deploy (lo decidís vos)

Canary primero en la máquina de desarrollo y en un cliente, **con backup manual tomado justo antes**.
Recién después a producción.
