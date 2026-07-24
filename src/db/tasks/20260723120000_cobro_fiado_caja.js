// Migration: imputar cobros de fiado a una caja (arqueo correcto).
//
// Dos flujos de cobro de deuda existen en el código y no comparten tabla "header":
//   - Cobro parcial (cuentasCorsRepository.EntregaDinero): crea UNA fila en ventas_entrega
//     (el cobro) que puede repartirse en VARIAS filas de ventas_pagos_detalle si salda más
//     de una venta impaga. El movimiento de caja es UNO solo por el monto total entregado,
//     así que idCaja se guarda en el header (ventas_entrega), no en el detalle.
//   - Pago completo (cuentasCorsRepository.ActualizarEstadoPago): no tiene header, inserta
//     directo en ventas_pagos_detalle (una sola fila, una sola venta). Ahí sí va idCaja.
//
// cajas_movimientos gana dos columnas de referencia (una por cada origen posible) para poder
// localizar y revertir el movimiento exacto al revertir el cobro, en vez de matchear por
// descripción/monto (frágil). Solo una de las dos se completa según el flujo que originó el
// movimiento.
//
// Handoff: documentos/handoff_cobro_fiado_caja_sonnet.md — Fase 2.

exports.up = async function(knex) {
  const hasIdCajaEntrega = await knex.schema.hasColumn('ventas_entrega', 'idCaja');
  if (!hasIdCajaEntrega) {
    await knex.schema.alterTable('ventas_entrega', table => {
      table.integer('idCaja').nullable();
      table.foreign('idCaja').references('cajas.id');
    });
  }

  const hasIdCajaDetalle = await knex.schema.hasColumn('ventas_pagos_detalle', 'idCaja');
  if (!hasIdCajaDetalle) {
    await knex.schema.alterTable('ventas_pagos_detalle', table => {
      table.integer('idCaja').nullable();
      table.foreign('idCaja').references('cajas.id');
    });
  }

  const hasIdEntregaMov = await knex.schema.hasColumn('cajas_movimientos', 'idEntrega');
  if (!hasIdEntregaMov) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.integer('idEntrega').nullable();
      table.foreign('idEntrega').references('ventas_entrega.id');
    });
  }

  const hasIdVentaPagoDetalleMov = await knex.schema.hasColumn('cajas_movimientos', 'idVentaPagoDetalle');
  if (!hasIdVentaPagoDetalleMov) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      // unsigned: ventas_pagos_detalle.id es INT UNSIGNED AUTO_INCREMENT (script.sql). La FK
      // exige que el tipo (incluido signed/unsigned) coincida exactamente con la columna
      // referenciada, si no MySQL la rechaza con "incompatible" aunque ambas sean INT.
      table.integer('idVentaPagoDetalle').unsigned().nullable();
      table.foreign('idVentaPagoDetalle').references('ventas_pagos_detalle.id');
    });
  }
};

exports.down = async function(knex) {
  const hasIdVentaPagoDetalleMov = await knex.schema.hasColumn('cajas_movimientos', 'idVentaPagoDetalle');
  if (hasIdVentaPagoDetalleMov) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.dropForeign('idVentaPagoDetalle');
      table.dropColumn('idVentaPagoDetalle');
    });
  }

  const hasIdEntregaMov = await knex.schema.hasColumn('cajas_movimientos', 'idEntrega');
  if (hasIdEntregaMov) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.dropForeign('idEntrega');
      table.dropColumn('idEntrega');
    });
  }

  const hasIdCajaDetalle = await knex.schema.hasColumn('ventas_pagos_detalle', 'idCaja');
  if (hasIdCajaDetalle) {
    await knex.schema.alterTable('ventas_pagos_detalle', table => {
      table.dropForeign('idCaja');
      table.dropColumn('idCaja');
    });
  }

  const hasIdCajaEntrega = await knex.schema.hasColumn('ventas_entrega', 'idCaja');
  if (hasIdCajaEntrega) {
    await knex.schema.alterTable('ventas_entrega', table => {
      table.dropForeign('idCaja');
      table.dropColumn('idCaja');
    });
  }
};
