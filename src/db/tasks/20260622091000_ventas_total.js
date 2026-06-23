exports.up = async function (knex) {
  // 1. Agregar columna total si no existe
  const hasTotal = await knex.schema.hasColumn('ventas', 'total');
  if (!hasTotal) {
    await knex.schema.alterTable('ventas', table => {
      table.decimal('total', 10, 2).nullable();
    });
  }

  // 2. Backfill: ventas existentes sin total, calculado desde el detalle
  await knex.raw(`
    UPDATE ventas v
    SET v.total = (
      SELECT COALESCE(SUM(d.cantidad * d.precio), 0)
      FROM ventas_detalle d
      WHERE d.idVenta = v.id
    )
    WHERE v.total IS NULL
  `);
};

exports.down = async function (knex) {
  const hasTotal = await knex.schema.hasColumn('ventas', 'total');
  if (hasTotal) {
    await knex.schema.alterTable('ventas', table => {
      table.dropColumn('total');
    });
  }
};
