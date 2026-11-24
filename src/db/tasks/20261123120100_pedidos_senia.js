/**
 * Migration: Seña de pedidos (PR B). Ver documentos/handoff_pedidos.md §3 y §5.
 * Requiere la migration 20261123120000_pedidos.js (PR A).
 *
 * - `pedidos_pagos`: N pagos a cuenta por pedido (tipo 'pago') y la devolución al cancelar (tipo 'devolucion').
 *   monto > 0 siempre; el signo lo da `tipo`. Nunca se borra una fila: se anula (`anulado`) y se compensa en caja.
 * - `pedidos.destinoSenia`: qué se hizo con la seña al cancelar ('devuelta' | 'retenida').
 * - `cajas_movimientos.idPedidoPago`: referencia al pago que originó el movimiento (FK ON DELETE SET NULL, mismo
 *   patrón que idEntrega / idVentaPagoDetalle).
 * - `cajas_movimientos.origen` suma 'pedido' (Fase 3.4-A: el origen clasifica el movimiento para ResumenCaja).
 *   Las señas en efectivo entran al efectivo esperado como línea propia, no como "ingreso manual".
 * - `tipos_pago`: medio 'SEÑA' (es el medio con el que la venta final aplica la seña ya cobrada).
 *
 * Tipos (architecture.md §12): tipos_pago.id es INT UNSIGNED; cajas.id es INT CON signo (idCaja sin unsigned).
 * idUsuario / idUsuarioAnulo sin FK (auditoría, §12.3.1). fecha la pone MySQL (§11.6). Sin CHARSET/COLLATE (§13).
 * Idempotente.
 *
 * Ñ: 'SEÑA' se inserta y se compara por parámetro. Si en alguna base latin1 la comparación no matchea,
 * ver la constante MEDIO_SENIA (src/utils/mediosPago.ts) y el checklist del handoff §8.
 */

const MEDIO_SENIA = 'SEÑA';

exports.up = async function (knex) {

  if (!(await knex.schema.hasColumn('pedidos', 'destinoSenia'))) {
    await knex.schema.alterTable('pedidos', (table) => {
      table.enu('destinoSenia', ['devuelta', 'retenida']).nullable();
    });
  }

  if (!(await knex.schema.hasTable('pedidos_pagos'))) {
    await knex.schema.createTable('pedidos_pagos', (table) => {
      table.increments('id');
      table.integer('idPedido').unsigned().notNullable();
      table.datetime('fecha').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
      table.integer('idUsuario').unsigned().nullable();                    // sin FK
      table.enu('tipo', ['pago', 'devolucion']).notNullable().defaultTo('pago');
      table.integer('idTipoPago').unsigned().notNullable();
      table.decimal('monto', 10, 2).notNullable();                         // > 0 siempre
      table.integer('idCaja').nullable();                                  // INT con signo; solo si el medio es EFECTIVO
      table.boolean('anulado').notNullable().defaultTo(false);             // TINYINT(1)
      table.datetime('fechaAnulacion').nullable();
      table.integer('idUsuarioAnulo').unsigned().nullable();               // sin FK

      table.index(['idPedido'], 'idx_pedidos_pagos_idPedido');
      table.index(['idCaja'], 'idx_pedidos_pagos_idCaja');

      table.foreign('idPedido', 'fk_pedidos_pagos_idPedido').references('pedidos.id');
      table.foreign('idTipoPago', 'fk_pedidos_pagos_idTipoPago').references('tipos_pago.id');
      table.foreign('idCaja', 'fk_pedidos_pagos_idCaja').references('cajas.id');
    });
  }

  if (!(await knex.schema.hasColumn('cajas_movimientos', 'idPedidoPago'))) {
    await knex.schema.alterTable('cajas_movimientos', (table) => {
      table.integer('idPedidoPago').unsigned().nullable();
      table.index(['idPedidoPago'], 'idx_cajas_movimientos_idPedidoPago');
      table.foreign('idPedidoPago', 'fk_cajas_movimientos_idPedidoPago').references('pedidos_pagos.id').onDelete('SET NULL');
    });
  }

  // origen: ENUM('manual','cobro','proveedor') -> suma 'pedido'. Solo se toca si todavía no lo tiene.
  const [filas] = await knex.raw(
    `SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cajas_movimientos' AND COLUMN_NAME = 'origen'`
  );
  const tipoActual = String(filas[0]?.tipo ?? '');
  if (tipoActual && !tipoActual.includes("'pedido'")) {
    await knex.raw("ALTER TABLE cajas_movimientos MODIFY COLUMN origen ENUM('manual','cobro','proveedor','pedido') NULL");
  }

  // Medio de pago SEÑA (idempotente). orden = el siguiente al último.
  const existe = await knex('tipos_pago').where({ nombre: MEDIO_SENIA }).first();
  if (!existe) {
    const [{ maxOrden }] = await knex('tipos_pago').max({ maxOrden: 'orden' });
    await knex('tipos_pago').insert({
      nombre: MEDIO_SENIA,
      icono: 'bookmark',        // 8 caracteres, entra en VARCHAR(15)
      color: '#f59e0b',
      orden: Number(maxOrden ?? 0) + 1,
    });
  }
};

exports.down = async function (knex) {
  await knex('tipos_pago').where({ nombre: MEDIO_SENIA }).del();

  // Los movimientos de seña vuelven a 'manual' antes de achicar el ENUM
  await knex('cajas_movimientos').where({ origen: 'pedido' }).update({ origen: 'manual' });
  await knex.raw("ALTER TABLE cajas_movimientos MODIFY COLUMN origen ENUM('manual','cobro','proveedor') NULL");

  if (await knex.schema.hasColumn('cajas_movimientos', 'idPedidoPago')) {
    await knex.schema.alterTable('cajas_movimientos', (table) => {
      table.dropForeign('idPedidoPago', 'fk_cajas_movimientos_idPedidoPago');
      table.dropIndex('idPedidoPago', 'idx_cajas_movimientos_idPedidoPago');
      table.dropColumn('idPedidoPago');
    });
  }

  await knex.schema.dropTableIfExists('pedidos_pagos');

  if (await knex.schema.hasColumn('pedidos', 'destinoSenia')) {
    await knex.schema.alterTable('pedidos', (table) => { table.dropColumn('destinoSenia'); });
  }
};
