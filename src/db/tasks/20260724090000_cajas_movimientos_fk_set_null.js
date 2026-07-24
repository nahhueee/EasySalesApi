// Migration: ajusta las FK de cajas_movimientos.idEntrega / idVentaPagoDetalle a ON DELETE
// SET NULL.
//
// Motivo: al revertir un cobro de fiado ya NO se borra la fila de cajas_movimientos (decisión
// de Nahu, 2026-07-24 — un ingreso imputado a una caja no debe desaparecer del historial,
// se compensa con una SALIDA en vez de eliminarse). Pero la reversión SÍ sigue borrando la
// fila de origen (ventas_entrega o ventas_pagos_detalle, comportamiento preexistente que no
// se tocó). Con la FK en modo RESTRICT (default), ese borrado falla. Con SET NULL, el
// movimiento de caja se conserva íntegro (monto, tipo, descripción — que ya incluye el
// número de entrega/venta como texto) y solo pierde el vínculo estructurado al registro
// borrado.
//
// Sigue a: 20260723120000_cobro_fiado_caja.js

exports.up = async function(knex) {
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.dropForeign('idEntrega');
  });
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.foreign('idEntrega').references('ventas_entrega.id').onDelete('SET NULL');
  });

  await knex.schema.alterTable('cajas_movimientos', table => {
    table.dropForeign('idVentaPagoDetalle');
  });
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.foreign('idVentaPagoDetalle').references('ventas_pagos_detalle.id').onDelete('SET NULL');
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.dropForeign('idVentaPagoDetalle');
  });
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.foreign('idVentaPagoDetalle').references('ventas_pagos_detalle.id');
  });

  await knex.schema.alterTable('cajas_movimientos', table => {
    table.dropForeign('idEntrega');
  });
  await knex.schema.alterTable('cajas_movimientos', table => {
    table.foreign('idEntrega').references('ventas_entrega.id');
  });
};
