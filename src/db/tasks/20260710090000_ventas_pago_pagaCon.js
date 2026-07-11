// Migration: agrega columna pagaCon a ventas_pago para trazabilidad.
// Almacena el monto que entregó el cliente en efectivo (para calcular vuelto).
// Solo se usa para pagos EFECTIVO; NULL en todos los demás métodos.
// Parte de PR B — UI/trazabilidad (2026-07-10).

exports.up = async function(knex) {
  const hasPagaCon = await knex.schema.hasColumn('ventas_pago', 'pagaCon');
  if (!hasPagaCon) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.decimal('pagaCon', 10, 2).nullable();
    });
  }
};

exports.down = async function(knex) {
  const hasPagaCon = await knex.schema.hasColumn('ventas_pago', 'pagaCon');
  if (hasPagaCon) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.dropColumn('pagaCon');
    });
  }
};
