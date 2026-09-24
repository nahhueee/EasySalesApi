// scripts/diagnostico/relaciones.js
//
// Lista declarativa de relaciones legacy/actuales de EasySales, usada por
// diagnosticar.js (Fase 3.0) y reusable después en 3.5 (limpieza + FKs).
//
// Las relaciones de las categorías "conFk" se verificaron una por una contra
// las migrations reales en src/db/tasks (no contra la prosa del handoff),
// para no arrastrar nombres de tabla/columna inventados a un chequeo que
// depende de acertarlos.
//
// No es exhaustiva por construcción: diagnosticar.js también detecta, vía
// information_schema.KEY_COLUMN_USAGE, las FKs que ya existen en la base
// analizada, y por separado lista cualquier columna id[A-Z]* que no
// aparezca en ninguna de las categorías de abajo ("relación no clasificada").
//
// Categorías:
//   - legacy: sin FK hoy, es el foco del diagnóstico (§5 handoff).
//   - conFk: la migration correspondiente ya declara la FK; el diagnóstico
//     verifica que además exista de verdad en cada base real (puede no
//     estarlo por deriva, o por haber quedado con el tipo incorrecto).
//   - auditoria: sin FK por diseño (architecture.md §12.3.1). Solo se
//     cuentan huérfanos, nunca se propone FK.
//   - polimorfica: sin FK posible (la columna apunta a distintas tablas
//     según otro campo). Solo se listan, no se corren checks de integridad.

const legacy = [
  { hija: 'ventas', columna: 'idCaja', padre: 'cajas', columnaPadre: 'id', nota: null },
  { hija: 'ventas', columna: 'idCliente', padre: 'clientes', columnaPadre: 'id', nota: '¿0 o NULL para consumidor final?' },
  { hija: 'ventas_detalle', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: 'PK compuesta (id, idVenta)' },
  { hija: 'ventas_detalle', columna: 'idProducto', padre: 'productos', columnaPadre: 'id', nota: 'VARIOS = id 1' },
  { hija: 'ventas_factura', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: null },
  { hija: 'ventas_pago', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: null },
  { hija: 'ventas_entrega', columna: 'idCliente', padre: 'clientes', columnaPadre: 'id', nota: null },
  { hija: 'ventas_entrega_detalle', columna: 'idEntrega', padre: 'ventas_entrega', columnaPadre: 'id', nota: null },
  { hija: 'ventas_entrega_detalle', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: null },
  { hija: 'ventas_pagos_detalle', columna: 'idTPago', padre: 'tipos_pago', columnaPadre: 'id', nota: null },
  { hija: 'cajas', columna: 'idResponsable', padre: 'usuarios', columnaPadre: 'id', nota: null },
  { hija: 'cajas_movimientos', columna: 'idCaja', padre: 'cajas', columnaPadre: 'id', nota: null },
  { hija: 'productos', columna: 'idCategoria', padre: 'categorias', columnaPadre: 'id', nota: 'valor 0 = sin categoría' },
  { hija: 'usuarios', columna: 'idCargo', padre: 'cargos', columnaPadre: 'id', nota: null },
  { hija: 'registros_detalle', columna: 'idRegistro', padre: 'registros', columnaPadre: 'id', nota: null },
  { hija: 'proveedor_cuenta_movimientos', columna: 'idTipoPago', padre: 'tipos_pago', columnaPadre: 'id', nota: null },
  { hija: 'proveedor_cuenta_movimientos', columna: 'idCaja', padre: 'cajas', columnaPadre: 'id', nota: null },
];

// Verificadas contra src/db/tasks/*.js (grep de table.foreign/.references), no contra la
// prosa del handoff. Cada comentario inline dice de qué migration sale.
const conFk = [
  // 20260319122913_ventas_pagos_detalle.js — el caso sospechoso del handoff: idVenta se creó
  // INT con signo, ventas.id es INT UNSIGNED.
  { hija: 'ventas_pagos_detalle', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: null },
  // 20260723120000_cobro_fiado_caja.js
  { hija: 'ventas_pagos_detalle', columna: 'idEntrega', padre: 'ventas_entrega', columnaPadre: 'id', nota: null },
  { hija: 'ventas_entrega', columna: 'idCaja', padre: 'cajas', columnaPadre: 'id', nota: null },
  { hija: 'ventas_pagos_detalle', columna: 'idCaja', padre: 'cajas', columnaPadre: 'id', nota: null },
  { hija: 'cajas_movimientos', columna: 'idEntrega', padre: 'ventas_entrega', columnaPadre: 'id', nota: 'ON DELETE SET NULL desde 20260724090000' },
  { hija: 'cajas_movimientos', columna: 'idVentaPagoDetalle', padre: 'ventas_pagos_detalle', columnaPadre: 'id', nota: 'ON DELETE SET NULL desde 20260724090000; tipo corregido a UNSIGNED en esa misma migration' },
  // 20260808130000_cajas_movimientos_id_proveedor_movimiento.js
  { hija: 'cajas_movimientos', columna: 'idProveedorMovimiento', padre: 'proveedor_cuenta_movimientos', columnaPadre: 'id', nota: null },
  // 20260903120000_cajas_movimientos_id_movimiento_compensado.js
  { hija: 'cajas_movimientos', columna: 'idMovimientoCompensado', padre: 'cajas_movimientos', columnaPadre: 'id', nota: 'auto-referencia, ON DELETE SET NULL' },
  // 20260817120000_productos_id_proveedor.js
  { hija: 'productos', columna: 'idProveedor', padre: 'proveedores', columnaPadre: 'id', nota: 'ON DELETE SET NULL' },
  // 20260622092000_cuenta_corriente_movimientos.js
  { hija: 'cuenta_corriente_movimientos', columna: 'idCliente', padre: 'clientes', columnaPadre: 'id', nota: null },
  // 20260605120000_presupuestos.js
  { hija: 'presupuestos', columna: 'idCliente', padre: 'clientes', columnaPadre: 'id', nota: null },
  { hija: 'presupuestos', columna: 'idVentaGenerada', padre: 'ventas', columnaPadre: 'id', nota: null },
  { hija: 'presupuestos_detalle', columna: 'idPresupuesto', padre: 'presupuestos', columnaPadre: 'id', nota: null },
  // 20260626120000_notas_credito.js
  { hija: 'notas_credito', columna: 'idVenta', padre: 'ventas', columnaPadre: 'id', nota: null },
  { hija: 'notas_credito_detalle', columna: 'idNotaCredito', padre: 'notas_credito', columnaPadre: 'id', nota: null },
  // 20260611120000_multiprecio.js — ojo: la tabla se llama productos_precios, no
  // "listas_precio_productos".
  { hija: 'productos_precios', columna: 'idProducto', padre: 'productos', columnaPadre: 'id', nota: null },
  { hija: 'productos_precios', columna: 'idLista', padre: 'listas_precio', columnaPadre: 'id', nota: null },
  // 20260615120000_precio_historial.js
  { hija: 'producto_precio_historial', columna: 'idProducto', padre: 'productos', columnaPadre: 'id', nota: null },
  { hija: 'producto_precio_historial', columna: 'idLista', padre: 'listas_precio', columnaPadre: 'id', nota: null },
  // 20260711140000_multiprecio_venta_clientes_ventas.js
  { hija: 'clientes', columna: 'idLista', padre: 'listas_precio', columnaPadre: 'id', nota: null },
  { hija: 'ventas', columna: 'idLista', padre: 'listas_precio', columnaPadre: 'id', nota: null },
  // 20260908120000_productos_proveedores.js
  { hija: 'productos_proveedores', columna: 'idProducto', padre: 'productos', columnaPadre: 'id', nota: null },
  { hija: 'productos_proveedores', columna: 'idProveedor', padre: 'proveedores', columnaPadre: 'id', nota: null },
  // 20260915120000_importaciones_costos.js — ojo: la tabla se llama importaciones_costos
  // (con su _detalle), no "importaciones_precios".
  { hija: 'importaciones_costos', columna: 'idProveedor', padre: 'proveedores', columnaPadre: 'id', nota: null },
  { hija: 'importaciones_costos_detalle', columna: 'idImportacion', padre: 'importaciones_costos', columnaPadre: 'id', nota: null },
  { hija: 'importaciones_costos_detalle', columna: 'idProducto', padre: 'productos', columnaPadre: 'id', nota: null },
];

const auditoria = [
  { hija: 'usuarios_movimientos', columna: 'idUsuario', padre: 'usuarios', columnaPadre: 'id', nota: 'sin FK por diseño, architecture.md §12.3.1 — solo contar huérfanos' },
];

const polimorficas = [
  { hija: 'cuenta_corriente_movimientos', columna: 'idReferencia', nota: 'apunta a distintas tablas según otro campo — solo listar, sin FK posible' },
  { hija: 'proveedor_cuenta_movimientos', columna: 'idReferencia', nota: 'apunta a distintas tablas según otro campo — solo listar, sin FK posible' },
];

// Todas las relaciones "normales" (legacy + conFk + auditoria) sobre las que
// corren los checks de compatibilidad de tipos (C4) e integridad (C5).
// Las polimórficas quedan afuera de esa lista a propósito: no tienen un
// padre único contra el cual chequear tipo o huérfanos.
const todasLasRelaciones = [...legacy, ...conFk, ...auditoria];

module.exports = {
  legacy,
  conFk,
  auditoria,
  polimorficas,
  todasLasRelaciones,
};
