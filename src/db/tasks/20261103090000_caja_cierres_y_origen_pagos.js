/**
 * Migration (DDL): Fase 3.4-A — modelo de cálculo de caja. Ver documentos/handoff_fase3_4a_caja_backend.md.
 *
 * - ventas_pagos_detalle.origen ENUM('venta','cobro') NULL: distingue el pago original de la venta
 *   del cobro posterior de un fiado. Queda NULL hasta el backfill (20261103090100). Desde este PR todo
 *   INSERT nuevo lo completa (ver ventasRepository.InsertPagoVentaDetalle y cuentasCorsRepository.EntregaDinero).
 * - cajas_movimientos.origen ENUM('manual','cobro','proveedor') NULL: revertir un cobro borra
 *   ventas_entrega / ventas_pagos_detalle y, por el ON DELETE SET NULL, el movimiento pierde su
 *   referencia; por eso se clasifica por esta columna y no por las referencias (A2 del handoff).
 * - cajas_cierres: una fila por cada cierre (una caja reabierta y vuelta a cerrar tiene varios; el
 *   último es el vigente). Tabla nueva → con FK a cajas (§12.1). idUsuario / idPuesto sin FK: es
 *   auditoría y tiene que sobrevivir al borrado de ambos (§12.3.1).
 * - cajas.id es INT con signo → idCaja también (sin unsigned). usuarios.id es INT UNSIGNED.
 * - fecha la pone MySQL (DEFAULT CURRENT_TIMESTAMP), nunca Node (§11.6).
 * - Sin CHARSET/COLLATE explícitos (§13). Idempotente (hasTable / hasColumn).
 */

const TABLA = 'cajas_cierres';

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('ventas_pagos_detalle', 'origen'))) {
    await knex.schema.alterTable('ventas_pagos_detalle', (table) => {
      table.enu('origen', ['venta', 'cobro']).nullable();
    });
  }

  if (!(await knex.schema.hasColumn('cajas_movimientos', 'origen'))) {
    await knex.schema.alterTable('cajas_movimientos', (table) => {
      table.enu('origen', ['manual', 'cobro', 'proveedor']).nullable();
    });
  }

  if (!(await knex.schema.hasTable(TABLA))) {
    await knex.schema.createTable(TABLA, (table) => {
      table.increments('id');                                              // INT UNSIGNED AUTO_INCREMENT PK
      table.integer('idCaja').notNullable();                               // mismo tipo que cajas.id (INT con signo)
      table.datetime('fecha').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
      table.integer('idUsuario').unsigned().nullable();                    // sin FK
      table.specificType('idPuesto', 'CHAR(36)').nullable();               // sin FK
      table.decimal('efectivoEsperado', 12, 2).notNullable();
      table.decimal('efectivoContado', 12, 2).nullable();                  // NULL = se cerró sin contar
      table.decimal('diferencia', 12, 2).nullable();                       // contado − esperado
      table.decimal('fondoAsignado', 12, 2).nullable();
      table.decimal('fondoPagado', 12, 2).notNullable().defaultTo(0);
      table.decimal('ventasAcumulador', 12, 2).notNullable();              // cajas.ventas al cerrar
      table.decimal('ventasRecalculado', 12, 2).notNullable();             // recalculado por ResumenCaja
      table.json('resumen').notNullable();                                 // foto completa del ResumenCaja
      table.string('observacion', 255).nullable();

      table.index(['idCaja', 'fecha'], 'idx_cajas_cierres_caja');
      table.foreign('idCaja', 'fk_cajas_cierres_idCaja').references('cajas.id');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(TABLA);
  if (await knex.schema.hasColumn('cajas_movimientos', 'origen')) {
    await knex.schema.alterTable('cajas_movimientos', (table) => { table.dropColumn('origen'); });
  }
  if (await knex.schema.hasColumn('ventas_pagos_detalle', 'origen')) {
    await knex.schema.alterTable('ventas_pagos_detalle', (table) => { table.dropColumn('origen'); });
  }
};
