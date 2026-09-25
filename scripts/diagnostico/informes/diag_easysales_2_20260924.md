# Diagnóstico — diag_easysales_2 — 2026-09-24
Origen: no detectada (no encontré "-- Server version" en las primeras 10 líneas) · Referencia: diag_referencia

## Resumen

- 0 hallazgos críticos · 46 hallazgos · 0 errores

| Check | Estado |
|---|---|
| C1 — Servidor y tablas | OK |
| C2 — Deriva contra referencia | HALLAZGO |
| C3 — knex_migrations | HALLAZGO |
| C4 — Compatibilidad de tipos por relación | HALLAZGO |
| C5 — Integridad por relación | HALLAZGO |
| C6 — Registros especiales | OK |
| C7 — Duplicados | HALLAZGO |
| C8 — Índices de architecture.md §12.2 | HALLAZGO |
| C9 — Pre-conciliación de caja | HALLAZGO |
| C10 — Stock | HALLAZGO |

## C1. Servidor y tablas

Estado: **OK**

MySQL local (donde corre este script): 8.0.40
MySQL del cliente (según --dump): no detectada (no encontré "-- Server version" en las primeras 10 líneas)

| Tabla | Engine | Collation | Filas (aprox) | Tamaño |
|---|---|---|---|---|
| backups | InnoDB | latin1_swedish_ci | 15 | 16.0 KB |
| cajas | InnoDB | latin1_swedish_ci | 387 | 48.0 KB |
| cajas_movimientos | InnoDB | latin1_swedish_ci | 23 | 80.0 KB |
| cargos | InnoDB | latin1_swedish_ci | 3 | 16.0 KB |
| categorias | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| clientes | InnoDB | latin1_swedish_ci | 7 | 32.0 KB |
| cuenta_corriente_movimientos | InnoDB | latin1_swedish_ci | 36 | 32.0 KB |
| etiquetas | InnoDB | latin1_swedish_ci | 4 | 16.0 KB |
| knex_migrations | InnoDB | latin1_swedish_ci | 42 | 16.0 KB |
| knex_migrations_lock | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| listas_precio | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| notas_credito | InnoDB | latin1_swedish_ci | 0 | 32.0 KB |
| notas_credito_detalle | InnoDB | latin1_swedish_ci | 0 | 48.0 KB |
| parametros | InnoDB | latin1_swedish_ci | 10 | 16.0 KB |
| parametros_facturacion | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| parametros_impresion | InnoDB | latin1_swedish_ci | 2 | 16.0 KB |
| presupuestos | InnoDB | latin1_swedish_ci | 0 | 48.0 KB |
| presupuestos_detalle | InnoDB | latin1_swedish_ci | 0 | 32.0 KB |
| producto_precio_historial | InnoDB | latin1_swedish_ci | 86 | 48.0 KB |
| productos | InnoDB | latin1_swedish_ci | 446 | 96.0 KB |
| productos_precios | InnoDB | latin1_swedish_ci | 446 | 96.0 KB |
| productos_proveedores | InnoDB | latin1_swedish_ci | 0 | 48.0 KB |
| proveedor_cuenta_movimientos | InnoDB | latin1_swedish_ci | 0 | 32.0 KB |
| proveedores | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| registros | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| registros_detalle | InnoDB | latin1_swedish_ci | 0 | 16.0 KB |
| tipos_pago | InnoDB | latin1_swedish_ci | 7 | 16.0 KB |
| usuarios | InnoDB | latin1_swedish_ci | 2 | 16.0 KB |
| usuarios_movimientos | InnoDB | latin1_swedish_ci | 2777 | 208.0 KB |
| ventas | InnoDB | latin1_swedish_ci | 3222 | 256.0 KB |
| ventas_detalle | InnoDB | latin1_swedish_ci | 8063 | 672.0 KB |
| ventas_entrega | InnoDB | latin1_swedish_ci | 19 | 32.0 KB |
| ventas_entrega_detalle | InnoDB | latin1_swedish_ci | 68 | 16.0 KB |
| ventas_factura | InnoDB | latin1_swedish_ci | 335 | 64.0 KB |
| ventas_pago | InnoDB | latin1_swedish_ci | 3222 | 240.0 KB |
| ventas_pagos_detalle | InnoDB | latin1_swedish_ci | 3170 | 240.0 KB |


## C2. Deriva contra referencia

Estado: **HALLAZGO**

- **HALLAZGO:** tablas que están en la referencia y faltan acá: importaciones_costos, importaciones_costos_detalle
### `cajas_movimientos`
- **HALLAZGO:** índices acá que no están en la referencia: idProveedorMovimiento
- **HALLAZGO:** FKs acá que no están en la referencia: idProveedorMovimiento->proveedor_cuenta_movimientos.id

### `knex_migrations`
- **HALLAZGO:** `migration_time`: IS_NULLABLE acá="NO" vs ref="YES"; COLUMN_DEFAULT acá="CURRENT_TIMESTAMP" vs ref="null"; EXTRA acá="DEFAULT_GENERATED on update CURRENT_TIMESTAMP" vs ref=""

### `productos`
- **HALLAZGO:** `idCategoria`: COLUMN_DEFAULT acá="null" vs ref="0"

### `proveedor_cuenta_movimientos`
- **HALLAZGO:** FKs acá que no están en la referencia: idProveedor->proveedores.id

### `ventas`
- **HALLAZGO:** columnas de la referencia que faltan acá: idempotencyKey
- **HALLAZGO:** `hora`: COLUMN_TYPE acá="varchar(5)" vs ref="varchar(8)"
- **HALLAZGO:** `idCaja`: IS_NULLABLE acá="NO" vs ref="YES"
- **HALLAZGO:** `obsBaja`: COLUMN_DEFAULT acá="" vs ref="null"
- **HALLAZGO:** índices de la referencia que faltan acá: idempotencyKey

### `ventas_entrega`
- **HALLAZGO:** `fecha`: IS_NULLABLE acá="NO" vs ref="YES"

### `ventas_pago`
- **HALLAZGO:** columnas acá que no están en la referencia: digital, efectivo, idPago


## C3. knex_migrations

Estado: **HALLAZGO**

- **HALLAZGO:** migrations en el directorio que no están aplicadas acá: 20260915120000_importaciones_costos.js, 20260922120000_ventas_idempotency_key.js, 20260922120100_ventas_hora_segundos.js
Primera migration aplicada: `20260319122219_add_campos_tipos_pago.js` (Wed Apr 01 2026 18:15:35 GMT-0300 (hora estándar de Argentina)) — aproxima la antigüedad de la instalación.

## C4. Compatibilidad de tipos por relación

Estado: **HALLAZGO**

- **HALLAZGO:** `ventas.idCliente` (int) vs `clientes.id` (int unsigned) — tipos incompatibles para FK. (¿0 o NULL para consumidor final?)
- **HALLAZGO:** `ventas_detalle.idVenta` (int) vs `ventas.id` (int unsigned) — tipos incompatibles para FK. (PK compuesta (id, idVenta))
- **HALLAZGO:** `ventas_detalle.idProducto` (int) vs `productos.id` (int unsigned) — tipos incompatibles para FK. (VARIOS = id 1)
- **HALLAZGO:** `ventas_factura.idVenta` (int) vs `ventas.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `ventas_pago.idVenta` (int) vs `ventas.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `ventas_entrega.idCliente` (int) vs `clientes.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `ventas_entrega_detalle.idVenta` (int) vs `ventas.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `ventas_pagos_detalle.idTPago` (int) vs `tipos_pago.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `cajas.idResponsable` (int) vs `usuarios.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `productos.idCategoria` (int) vs `categorias.id` (int unsigned) — tipos incompatibles para FK. (valor 0 = sin categoría)
- **HALLAZGO:** `usuarios.idCargo` (int) vs `cargos.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `registros_detalle.idRegistro` (int) vs `registros.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `proveedor_cuenta_movimientos.idTipoPago` (int) vs `tipos_pago.id` (int unsigned) — tipos incompatibles para FK.
- **HALLAZGO:** `ventas_pagos_detalle.idVenta` (int) vs `ventas.id` (int unsigned) — tipos incompatibles para FK.
`usuarios_movimientos.idUsuario` (int) vs `usuarios.id` (int unsigned) — difieren, pero esta relación nunca tiene FK por diseño (sin FK por diseño, architecture.md §12.3.1 — solo contar huérfanos). Informativo, no es hallazgo.
| Relación | Referencia | Tipo hija | Tipo padre | Resultado |
|---|---|---|---|---|
| ventas.idCaja | cajas.id | int | int | OK · sin índice en hija |
| ventas.idCliente | clientes.id | int | int unsigned | DIFIEREN · sin índice en hija |
| ventas_detalle.idVenta | ventas.id | int | int unsigned | DIFIEREN |
| ventas_detalle.idProducto | productos.id | int | int unsigned | DIFIEREN · sin índice en hija |
| ventas_factura.idVenta | ventas.id | int | int unsigned | DIFIEREN |
| ventas_pago.idVenta | ventas.id | int | int unsigned | DIFIEREN |
| ventas_entrega.idCliente | clientes.id | int | int unsigned | DIFIEREN · sin índice en hija |
| ventas_entrega_detalle.idEntrega | ventas_entrega.id | int | int | OK · sin índice en hija |
| ventas_entrega_detalle.idVenta | ventas.id | int | int unsigned | DIFIEREN · sin índice en hija |
| ventas_pagos_detalle.idTPago | tipos_pago.id | int | int unsigned | DIFIEREN · sin índice en hija |
| cajas.idResponsable | usuarios.id | int | int unsigned | DIFIEREN · sin índice en hija |
| cajas_movimientos.idCaja | cajas.id | int | int | OK · sin índice en hija |
| productos.idCategoria | categorias.id | int | int unsigned | DIFIEREN · sin índice en hija |
| usuarios.idCargo | cargos.id | int | int unsigned | DIFIEREN · sin índice en hija |
| registros_detalle.idRegistro | registros.id | int | int unsigned | DIFIEREN · sin índice en hija |
| proveedor_cuenta_movimientos.idTipoPago | tipos_pago.id | int | int unsigned | DIFIEREN · sin índice en hija |
| proveedor_cuenta_movimientos.idCaja | cajas.id | int | int | OK · sin índice en hija |
| ventas_pagos_detalle.idVenta | ventas.id | int | int unsigned | DIFIEREN · sin índice en hija |
| ventas_pagos_detalle.idEntrega | ventas_entrega.id | int | int | OK · sin índice en hija |
| ventas_entrega.idCaja | cajas.id | int | int | OK |
| ventas_pagos_detalle.idCaja | cajas.id | int | int | OK |
| cajas_movimientos.idEntrega | ventas_entrega.id | int | int | OK |
| cajas_movimientos.idVentaPagoDetalle | ventas_pagos_detalle.id | int unsigned | int unsigned | OK |
| cajas_movimientos.idProveedorMovimiento | proveedor_cuenta_movimientos.id | int unsigned | int unsigned | OK |
| cajas_movimientos.idMovimientoCompensado | cajas_movimientos.id | int unsigned | int unsigned | OK |
| productos.idProveedor | proveedores.id | int unsigned | int unsigned | OK |
| cuenta_corriente_movimientos.idCliente | clientes.id | int unsigned | int unsigned | OK |
| presupuestos.idCliente | clientes.id | int unsigned | int unsigned | OK |
| presupuestos.idVentaGenerada | ventas.id | int unsigned | int unsigned | OK |
| presupuestos_detalle.idPresupuesto | presupuestos.id | int unsigned | int unsigned | OK |
| notas_credito.idVenta | ventas.id | int unsigned | int unsigned | OK |
| notas_credito_detalle.idNotaCredito | notas_credito.id | int unsigned | int unsigned | OK |
| productos_precios.idProducto | productos.id | int unsigned | int unsigned | OK |
| productos_precios.idLista | listas_precio.id | int unsigned | int unsigned | OK |
| producto_precio_historial.idProducto | productos.id | int unsigned | int unsigned | OK |
| producto_precio_historial.idLista | listas_precio.id | int unsigned | int unsigned | OK |
| clientes.idLista | listas_precio.id | int unsigned | int unsigned | OK |
| ventas.idLista | listas_precio.id | int unsigned | int unsigned | OK |
| productos_proveedores.idProducto | productos.id | int unsigned | int unsigned | OK |
| productos_proveedores.idProveedor | proveedores.id | int unsigned | int unsigned | OK |
| importaciones_costos.idProveedor | proveedores.id | — | — | (no existe en esta base) |
| importaciones_costos_detalle.idImportacion | importaciones_costos.id | — | — | (no existe en esta base) |
| importaciones_costos_detalle.idProducto | productos.id | — | — | (no existe en esta base) |
| usuarios_movimientos.idUsuario | usuarios.id | int | int unsigned | DIFIEREN (sin FK por diseño) · sin índice en hija |


### Columnas id* sin clasificar

No se adivina a qué tabla apuntan — agregarlas a relaciones.js si corresponde:

- notas_credito_detalle.idProducto
- notas_credito_detalle.idVentaDetalle
- presupuestos.idCaja
- presupuestos.idUsuario
- presupuestos.idUsuarioModifico
- presupuestos_detalle.idProducto
- producto_precio_historial.idUsuario
- proveedor_cuenta_movimientos.idCompra
- proveedor_cuenta_movimientos.idProveedor
- usuarios_movimientos.idPuesto
- ventas_pago.idPago

## C5. Integridad por relación

Estado: **HALLAZGO**

### `ventas.idCaja` -> `cajas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 82
- **HALLAZGO:** 82 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 23, 73, 102, 126, 130, 149, 187, 213, 239, 273, 313, 335, 347, 384, 395, 401, 410, 425, 504, 567 (¿0 o NULL para consumidor final?)

### `ventas_detalle.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_detalle.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_factura.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pago.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_entrega.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 6
- **HALLAZGO:** 6 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 1, 2, 3, 4, 5, 7

### `ventas_entrega_detalle.idEntrega` -> `ventas_entrega.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_entrega_detalle.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idTPago` -> `tipos_pago.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `cajas.idResponsable` -> `usuarios.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idCaja` -> `cajas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos.idCategoria` -> `categorias.id`
- NULL: 371 · = 0: 75 · huérfanos: 0

### `usuarios.idCargo` -> `cargos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `registros_detalle.idRegistro` -> `registros.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `proveedor_cuenta_movimientos.idTipoPago` -> `tipos_pago.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `proveedor_cuenta_movimientos.idCaja` -> `cajas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idEntrega` -> `ventas_entrega.id`
- NULL: 3146 · = 0: 0 · huérfanos: 0

### `ventas_entrega.idCaja` -> `cajas.id`
- NULL: 16 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idCaja` -> `cajas.id`
- NULL: 3170 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idEntrega` -> `ventas_entrega.id`
- NULL: 20 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idVentaPagoDetalle` -> `ventas_pagos_detalle.id`
- NULL: 23 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idProveedorMovimiento` -> `proveedor_cuenta_movimientos.id`
- NULL: 23 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idMovimientoCompensado` -> `cajas_movimientos.id`
- NULL: 23 · = 0: 0 · huérfanos: 0

### `productos.idProveedor` -> `proveedores.id`
- NULL: 446 · = 0: 0 · huérfanos: 0

### `cuenta_corriente_movimientos.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `presupuestos.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `presupuestos.idVentaGenerada` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `presupuestos_detalle.idPresupuesto` -> `presupuestos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `notas_credito.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `notas_credito_detalle.idNotaCredito` -> `notas_credito.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos_precios.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos_precios.idLista` -> `listas_precio.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `producto_precio_historial.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `producto_precio_historial.idLista` -> `listas_precio.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `clientes.idLista` -> `listas_precio.id`
- NULL: 7 · = 0: 0 · huérfanos: 0

### `ventas.idLista` -> `listas_precio.id`
- NULL: 3222 · = 0: 0 · huérfanos: 0

### `productos_proveedores.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos_proveedores.idProveedor` -> `proveedores.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `usuarios_movimientos.idUsuario` -> `usuarios.id`
- NULL: 0 · = 0: 0 · huérfanos: 0


## C6. Registros especiales

Estado: **OK**

productos.id=1: codigo="*" — OK
tipos_pago.id=1: nombre="EFECTIVO" — OK
clientes.id=1 es "CONSUMIDOR FINAL": sí
cargos.id=1: nombre="ADMINISTRADOR" — OK
cargos.id=2: nombre="ENCARGADO" — OK
cargos.id=3: nombre="EMPLEADO" — OK

## C7. Duplicados

Estado: **HALLAZGO**

productos.codigo duplicado (entre activos): 0 código(s), máximo 0 repeticiones.
clientes.nroDocumento duplicado: 1 documento(s), máximo 2 repeticiones.
- **HALLAZGO:** 1 documento(s) de cliente duplicados (máx 2 repeticiones).

## C8. Índices de architecture.md §12.2

Estado: **HALLAZGO**

- **HALLAZGO:** `ventas.idCaja` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `ventas.idCliente` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `ventas.fecha` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `ventas_detalle.idProducto` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `ventas_pagos_detalle.idVenta` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `cajas.idResponsable` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `cajas.fecha` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `cajas_movimientos.idCaja` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `productos.codigo` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
- **HALLAZGO:** `productos.idCategoria` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.
| Columna | Estado |
|---|---|
| ventas.idCaja | SIN ÍNDICE |
| ventas.idCliente | SIN ÍNDICE |
| ventas.fecha | SIN ÍNDICE |
| ventas_detalle.idVenta | tiene índice |
| ventas_detalle.idProducto | SIN ÍNDICE |
| ventas_pago.idVenta | tiene índice |
| ventas_pagos_detalle.idVenta | SIN ÍNDICE |
| cajas.idResponsable | SIN ÍNDICE |
| cajas.fecha | SIN ÍNDICE |
| cajas_movimientos.idCaja | SIN ÍNDICE |
| productos.codigo | SIN ÍNDICE |
| productos.idCategoria | SIN ÍNDICE |
| eventos.puesto_id | (no existe en esta base) |
| eventos.usuario_id | (no existe en esta base) |
| eventos.fecha | (no existe en esta base) |
| eventos.entidad | (no existe en esta base) |
| puestos.ultimo_visto | (no existe en esta base) |


## C9. Pre-conciliación de caja

Estado: **HALLAZGO**

ventas.total NULL: 0 · = 0: 6 (total, todos los años)
| Año | NULL | = 0 |
|---|---|---|
| 2025 | 0 | 6 |
| 2026 | 0 | 0 |

- **HALLAZGO:** 0 venta(s) con total NULL y 6 con total = 0.
Cajas finalizadas analizadas: 375
- dan 0 de diferencia: 307
- dan distinto de 0: 68
- suma absoluta de diferencias: 82978.50

| Año | Suma absoluta de diferencias |
|---|---|
| 2025 | 35410.00 |
| 2026 | 47568.50 |

- **HALLAZGO:** 68 caja(s) finalizada(s) con `cajas.ventas` distinto de la suma de `ventas.total`. No se define ni corrige acá qué debería ir en cajas.ventas (decisión de negocio, 3.4).

## C10. Stock

Estado: **HALLAZGO**

Productos activos: 445
Con cantidad < 0: 89
- **HALLAZGO:** 89 producto(s) activo(s) con cantidad negativa.
Con cantidad decimal en unidad distinta de KG: 4
- **HALLAZGO:** 4 producto(s) con cantidad decimal fuera de unidad KG.
Con soloPrecio=1 y cantidad<>0: 9
- **HALLAZGO:** 9 producto(s) con soloPrecio=1 y cantidad<>0 (debería ser siempre 0).

Filas de `ventas_detalle` por año (volumen para estimar el costo de los ALTER de 3.5):
| Año | Filas |
|---|---|
| 2025 | 1460 |
| 2026 | 6603 |

