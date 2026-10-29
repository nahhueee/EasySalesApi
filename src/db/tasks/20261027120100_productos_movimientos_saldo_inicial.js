/**
 * Migration de DATOS (separada de la DDL, §13.3): un movimiento SALDO_INICIAL por producto para
 * que el historial de stock arranque desde un número conocido. Fase 3.3.
 *
 * - Solo productos activos, que no sean soloPrecio ni VARIOS (codigo = '*'), y que todavía no
 *   tengan ningún movimiento → idempotente: correrla de nuevo no duplica.
 * - Un solo INSERT ... SELECT (no un loop). idUsuario / idPuesto en NULL.
 * - Los stocks negativos existentes se copian tal cual: el historial arranca del valor actual,
 *   sea cual sea (corregirlos está fuera de alcance).
 * - down: borra solo las filas SALDO_INICIAL.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasTable('productos_movimientos'))) return;

  await knex.raw(`
    INSERT INTO productos_movimientos
      (idProducto, motivo, cantidadDelta, cantidadResultante, idReferencia, idUsuario, idPuesto, observacion)
    SELECT p.id, 'SALDO_INICIAL', p.cantidad, p.cantidad, NULL, NULL, NULL,
           'Saldo al activar el historial de stock'
    FROM productos p
    WHERE p.fechaBaja IS NULL
      AND COALESCE(p.soloPrecio, 0) = 0
      AND p.codigo <> '*'
      AND p.cantidad IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM productos_movimientos pm WHERE pm.idProducto = p.id)
  `);
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasTable('productos_movimientos'))) return;
  await knex('productos_movimientos').where({ motivo: 'SALDO_INICIAL' }).del();
};
