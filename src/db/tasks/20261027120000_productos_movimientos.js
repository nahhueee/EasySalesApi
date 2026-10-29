/**
 * Migration: tabla `productos_movimientos` (Fase 3.3 — trazabilidad de stock) y
 * `notas_credito.reingresoStock`. Ver documentos/handoff_fase3_3_stock.md y architecture.md §12.4.
 *
 * - Toda modificación de productos.cantidad pasa por StockRepo.Mover (data/stockRepository.ts),
 *   que escribe una fila acá en la misma transacción.
 * - FK a productos (tabla nueva → con FK, §12.1), sin ON DELETE (RESTRICT): un producto con
 *   movimientos no se borra físicamente; ver productosRepository.Eliminar.
 * - idUsuario / idPuesto sin FK: es auditoría, tiene que sobrevivir al borrado de ambos (§12.3.1).
 * - unsigned OBLIGATORIO en idProducto: productos.id es increments() (INT UNSIGNED).
 * - fecha la pone MySQL (DEFAULT CURRENT_TIMESTAMP), nunca Node (§11.6).
 * - Sin CHARSET/COLLATE explícitos (§13). Idempotente (hasTable / hasColumn).
 */

const TABLA = 'productos_movimientos';

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable(TABLA))) {
    await knex.schema.createTable(TABLA, (table) => {
      table.bigIncrements('id');                                          // BIGINT UNSIGNED AUTO_INCREMENT PK
      table.integer('idProducto').unsigned().notNullable();
      table.datetime('fecha').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
      table.string('motivo', 30).notNullable();                           // catálogo MotivoStock
      table.decimal('cantidadDelta', 10, 3).notNullable();                // + entra, - sale
      table.decimal('cantidadResultante', 10, 3).notNullable();
      table.integer('idReferencia').unsigned().nullable();               // idVenta / idNotaCredito según motivo
      table.integer('idUsuario').unsigned().nullable();                  // sin FK
      table.specificType('idPuesto', 'CHAR(36)').nullable();             // sin FK
      table.string('observacion', 255).nullable();

      table.index(['idProducto', 'fecha'], 'idx_pm_producto_fecha');
      table.index(['motivo', 'idReferencia'], 'idx_pm_motivo_ref');
      table.foreign('idProducto', 'fk_productos_movimientos_idProducto').references('productos.id');
    });
  }

  if (!(await knex.schema.hasColumn('notas_credito', 'reingresoStock'))) {
    await knex.schema.alterTable('notas_credito', (table) => {
      table.boolean('reingresoStock').notNullable().defaultTo(false);   // TINYINT(1)
    });
  }
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('notas_credito', 'reingresoStock')) {
    await knex.schema.alterTable('notas_credito', (table) => {
      table.dropColumn('reingresoStock');
    });
  }
  await knex.schema.dropTableIfExists(TABLA);
};
