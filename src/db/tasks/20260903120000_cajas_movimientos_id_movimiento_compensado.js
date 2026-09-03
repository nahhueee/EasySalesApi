// Migration: columna idMovimientoCompensado en cajas_movimientos (redisenio pantalla
// Movimientos + cambio "Eliminar" -> "Anular", decision de Nahu documentada en
// project_anular_movimientos_caja.md).
//
// Autoreferenciada a cajas_movimientos.id, que es INT UNSIGNED AUTO_INCREMENT (ver
// src/db/script.sql) -> misma trampa signed/unsigned que ya hizo fallar la FK de
// idVentaPagoDetalle (20260723120000_cobro_fiado_caja.js): unsigned obligatorio.
//
// ON DELETE SET NULL, mismo criterio que idEntrega/idVentaPagoDetalle
// (20260724090000_cajas_movimientos_fk_set_null.js): esta tabla es append-only (nunca se
// borra un movimiento, se compensa con el inverso), pero si algun dia se borra la fila del
// movimiento original no tiene que romper la FK del que lo compenso.
//
// Semantica de la columna:
// - En el movimiento ORIGINAL: apunta al movimiento inverso que lo anulo (no nulo = ya fue
//   anulado, no se puede volver a anular).
// - En el movimiento INVERSO (la compensacion): queda NULL. Para saber si un movimiento ES
//   una compensacion de otro se consulta al reves (existe otra fila con
//   idMovimientoCompensado = este id), no se necesita una segunda columna.

exports.up = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas_movimientos', 'idMovimientoCompensado');
  if (!tiene) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.integer('idMovimientoCompensado').unsigned().nullable();
      table.foreign('idMovimientoCompensado').references('cajas_movimientos.id').onDelete('SET NULL');
    });
  }
};

exports.down = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas_movimientos', 'idMovimientoCompensado');
  if (tiene) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.dropForeign('idMovimientoCompensado');
      table.dropColumn('idMovimientoCompensado');
    });
  }
};
