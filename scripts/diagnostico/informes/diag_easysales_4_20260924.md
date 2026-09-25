# Diagnóstico — diag_easysales_4 — 2026-09-24
Origen: no detectada (no encontré "-- Server version" en las primeras 10 líneas) · Referencia: diag_referencia

## Resumen

- 0 hallazgos críticos · 42 hallazgos · 0 errores

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
| backups | InnoDB | utf8mb4_0900_ai_ci | 7 | 16.0 KB |
| cajas | InnoDB | utf8mb4_0900_ai_ci | 107 | 16.0 KB |
| cajas_movimientos | InnoDB | utf8mb4_0900_ai_ci | 26 | 80.0 KB |
| cargos | InnoDB | utf8mb4_0900_ai_ci | 3 | 16.0 KB |
| categorias | InnoDB | utf8mb4_0900_ai_ci | 5 | 16.0 KB |
| clientes | InnoDB | utf8mb4_0900_ai_ci | 232 | 64.0 KB |
| cuenta_corriente_movimientos | InnoDB | utf8mb4_0900_ai_ci | 775 | 96.0 KB |
| etiquetas | InnoDB | utf8mb4_0900_ai_ci | 3 | 16.0 KB |
| knex_migrations | InnoDB | utf8mb4_0900_ai_ci | 42 | 16.0 KB |
| knex_migrations_lock | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| listas_precio | InnoDB | utf8mb4_0900_ai_ci | 4 | 16.0 KB |
| notas_credito | InnoDB | utf8mb4_0900_ai_ci | 5 | 32.0 KB |
| notas_credito_detalle | InnoDB | utf8mb4_0900_ai_ci | 0 | 48.0 KB |
| parametros | InnoDB | utf8mb4_0900_ai_ci | 9 | 16.0 KB |
| parametros_facturacion | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| parametros_impresion | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| presupuestos | InnoDB | utf8mb4_0900_ai_ci | 276 | 48.0 KB |
| presupuestos_detalle | InnoDB | utf8mb4_0900_ai_ci | 2711 | 336.0 KB |
| producto_precio_historial | InnoDB | utf8mb4_0900_ai_ci | 5927 | 880.0 KB |
| productos | InnoDB | utf8mb4_0900_ai_ci | 1667 | 272.0 KB |
| productos_precios | InnoDB | utf8mb4_0900_ai_ci | 3770 | 464.0 KB |
| productos_proveedores | InnoDB | utf8mb4_0900_ai_ci | 0 | 48.0 KB |
| proveedor_cuenta_movimientos | InnoDB | utf8mb4_0900_ai_ci | 0 | 32.0 KB |
| proveedores | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| registros | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| registros_detalle | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| tipos_pago | InnoDB | utf8mb4_0900_ai_ci | 7 | 16.0 KB |
| usuarios | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| usuarios_movimientos | InnoDB | utf8mb4_0900_ai_ci | 6952 | 528.0 KB |
| ventas | InnoDB | utf8mb4_0900_ai_ci | 1730 | 176.0 KB |
| ventas_detalle | InnoDB | utf8mb4_0900_ai_ci | 7202 | 1.5 MB |
| ventas_entrega | InnoDB | utf8mb4_0900_ai_ci | 42 | 32.0 KB |
| ventas_entrega_detalle | InnoDB | utf8mb4_0900_ai_ci | 78 | 16.0 KB |
| ventas_factura | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| ventas_pago | InnoDB | utf8mb4_0900_ai_ci | 0 | 16.0 KB |
| ventas_pagos_detalle | InnoDB | utf8mb4_0900_ai_ci | 0 | 32.0 KB |


## C2. Deriva contra referencia

Estado: **HALLAZGO**

- **HALLAZGO:** tablas que están en la referencia y faltan acá: importaciones_costos, importaciones_costos_detalle
### `cajas_movimientos`
- **HALLAZGO:** índices acá que no están en la referencia: idProveedorMovimiento
- **HALLAZGO:** FKs acá que no están en la referencia: idProveedorMovimiento->proveedor_cuenta_movimientos.id

### `productos`
- **HALLAZGO:** `fechaBaja`: COLUMN_TYPE acá="date" vs ref="datetime"

### `proveedor_cuenta_movimientos`
- **HALLAZGO:** FKs acá que no están en la referencia: idProveedor->proveedores.id

### `ventas`
- **HALLAZGO:** columnas de la referencia que faltan acá: idempotencyKey
- **HALLAZGO:** `hora`: COLUMN_TYPE acá="varchar(5)" vs ref="varchar(8)"
- **HALLAZGO:** índices de la referencia que faltan acá: idempotencyKey

### `ventas_detalle`
- **HALLAZGO:** índices de la referencia que faltan acá: idVenta


## C3. knex_migrations

Estado: **HALLAZGO**

- **HALLAZGO:** migrations en el directorio que no están aplicadas acá: 20260915120000_importaciones_costos.js, 20260922120000_ventas_idempotency_key.js, 20260922120100_ventas_hora_segundos.js
Primera migration aplicada: `20260319122219_add_campos_tipos_pago.js` (Mon Jun 01 2026 18:52:02 GMT-0300 (hora estándar de Argentina)) — aproxima la antigüedad de la instalación.

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

## C5. Integridad por relación

Estado: **HALLAZGO**

### `ventas.idCaja` -> `cajas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 3
- **HALLAZGO:** 3 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 6, 7, 12 (¿0 o NULL para consumidor final?)

### `ventas_detalle.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_detalle.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 16
- **HALLAZGO:** 16 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 3, 4, 5, 6, 7, 8, 9, 10, 11, 19, 20, 21, 285, 476, 564, 1190 (VARIOS = id 1)

### `ventas_factura.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pago.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_entrega.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_entrega_detalle.idEntrega` -> `ventas_entrega.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_entrega_detalle.idVenta` -> `ventas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idTPago` -> `tipos_pago.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `cajas.idResponsable` -> `usuarios.id`
- NULL: 0 · = 0: 0 · huérfanos: 8
- **HALLAZGO:** 8 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 2, 3, 4, 5, 7, 9, 10, 13

### `cajas_movimientos.idCaja` -> `cajas.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos.idCategoria` -> `categorias.id`
- NULL: 0 · = 0: 1565 · huérfanos: 0

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
- NULL: 1462 · = 0: 0 · huérfanos: 0

### `ventas_entrega.idCaja` -> `cajas.id`
- NULL: 30 · = 0: 0 · huérfanos: 0

### `ventas_pagos_detalle.idCaja` -> `cajas.id`
- NULL: 1537 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idEntrega` -> `ventas_entrega.id`
- NULL: 14 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idVentaPagoDetalle` -> `ventas_pagos_detalle.id`
- NULL: 23 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idProveedorMovimiento` -> `proveedor_cuenta_movimientos.id`
- NULL: 26 · = 0: 0 · huérfanos: 0

### `cajas_movimientos.idMovimientoCompensado` -> `cajas_movimientos.id`
- NULL: 26 · = 0: 0 · huérfanos: 0

### `productos.idProveedor` -> `proveedores.id`
- NULL: 1667 · = 0: 0 · huérfanos: 0

### `cuenta_corriente_movimientos.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `presupuestos.idCliente` -> `clientes.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `presupuestos.idVentaGenerada` -> `ventas.id`
- NULL: 226 · = 0: 0 · huérfanos: 0

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
- NULL: 210 · = 0: 0 · huérfanos: 0

### `ventas.idLista` -> `listas_precio.id`
- NULL: 425 · = 0: 0 · huérfanos: 0

### `productos_proveedores.idProducto` -> `productos.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `productos_proveedores.idProveedor` -> `proveedores.id`
- NULL: 0 · = 0: 0 · huérfanos: 0

### `usuarios_movimientos.idUsuario` -> `usuarios.id`
- NULL: 0 · = 0: 0 · huérfanos: 2
- **HALLAZGO:** 2 fila(s) huérfana(s) (columna identificadora: `id`). Ejemplos: 4717, 4718 (sin FK por diseño, architecture.md §12.3.1 — solo contar huérfanos)


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

productos.codigo duplicado (entre activos): 1 código(s), máximo 2 repeticiones.
- **HALLAZGO:** 1 código(s) de producto duplicados (máx 2 repeticiones).
clientes.nroDocumento duplicado: 0 documento(s), máximo 0 repeticiones.

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

ventas.total NULL: 0 · = 0: 0 (total, todos los años)
| Año | NULL | = 0 |
|---|---|---|
| 2026 | 0 | 0 |

Cajas finalizadas analizadas: 105
- dan 0 de diferencia: 98
- dan distinto de 0: 7
- suma absoluta de diferencias: 551387.50

| Año | Suma absoluta de diferencias |
|---|---|
| 2026 | 551387.50 |

- **HALLAZGO:** 7 caja(s) finalizada(s) con `cajas.ventas` distinto de la suma de `ventas.total`. No se define ni corrige acá qué debería ir en cajas.ventas (decisión de negocio, 3.4).

## C10. Stock

Estado: **HALLAZGO**

Productos activos: 1665
Con cantidad < 0: 170
- **HALLAZGO:** 170 producto(s) activo(s) con cantidad negativa.
Con cantidad decimal en unidad distinta de KG: 16
- **HALLAZGO:** 16 producto(s) con cantidad decimal fuera de unidad KG.
Con soloPrecio=1 y cantidad<>0: 0

Filas de `ventas_detalle` por año (volumen para estimar el costo de los ALTER de 3.5):
| Año | Filas |
|---|---|
| 2026 | 7202 |

