// Migration: FK de cajas_movimientos hacia proveedor_cuenta_movimientos (Fase 2, PR 6).
//
// unsigned OBLIGATORIO: proveedor_cuenta_movimientos.id es `increments()` (INT UNSIGNED).
// MySQL rechaza la FK si signed/unsigned no coincide exactamente, aunque ambas columnas sean
// INT — la misma trampa que ya hizo fallar 20260723120000_cobro_fiado_caja.js con
// idVentaPagoDetalle (ver 20260724090000_cajas_movimientos_fk_set_null.js).
//
// FK en RESTRICT (default de knex), a diferencia de idEntrega/idVentaPagoDetalle que están en
// ON DELETE SET NULL: esas dos SÍ pueden perder su fila de origen (revertir un cobro de fiado
// borra la cabecera). Acá el ledger de proveedores es append-only — nunca se borra un
// movimiento, se compensa — así que RESTRICT es correcto y de paso protege contra un borrado
// accidental de la fila del ledger mientras haya un movimiento de caja que la referencia.
//
// Handoff: documentos/handoff_proveedores_fase2.md — PR 6.

exports.up = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas_movimientos', 'idProveedorMovimiento');
  if (!tiene) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.integer('idProveedorMovimiento').unsigned().nullable();
      table.foreign('idProveedorMovimiento').references('proveedor_cuenta_movimientos.id');
    });
  }
};

exports.down = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas_movimientos', 'idProveedorMovimiento');
  if (tiene) {
    await knex.schema.alterTable('cajas_movimientos', table => {
      table.dropForeign('idProveedorMovimiento');
      table.dropColumn('idProveedorMovimiento');
    });
  }
};
