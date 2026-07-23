exports.up = async function (knex) {
  // 1. Agregar columna total si no existe
  const hasTotal = await knex.schema.hasColumn('ventas', 'total');
  if (!hasTotal) {
    await knex.schema.alterTable('ventas', table => {
      table.decimal('total', 10, 2).nullable();
    });
  }

  // 1b. Indice en ventas_detalle.idVenta. La PK de esa tabla es (id, idVenta),
  // con idVenta en segundo lugar no sirve como acceso por idVenta. Sin este
  // indice, el backfill de abajo (y cualquier otra consulta que filtre por
  // idVenta, como ObtenerVentasImpagas) hace table scan completo de
  // ventas_detalle por cada fila de ventas — en comercios con historial real
  // esto fue lo que colgó esta misma migración en producción (ver incidente
  // 2026-07-22: migración se colgó y hubo que sacarla en un cliente).
  const [idxRows] = await knex.raw(
    `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
     WHERE table_schema = DATABASE() AND table_name = 'ventas_detalle' AND index_name = 'idx_ventas_detalle_idVenta'`
  );
  if (Number(idxRows[0].cnt) === 0) {
    await knex.schema.alterTable('ventas_detalle', table => {
      table.index('idVenta', 'idx_ventas_detalle_idVenta');
    });
  }

  // 2. Backfill: ventas existentes sin total, calculado desde el detalle.
  // UPDATE con JOIN agregado en vez de subquery correlacionado por fila —
  // una sola pasada, se apoya en el indice de arriba. La version anterior
  // (subquery por fila, sin indice) es la que colgó la migración.
  await knex.raw(`
    UPDATE ventas v
    JOIN (
      SELECT idVenta, COALESCE(SUM(cantidad * precio), 0) AS tot
      FROM ventas_detalle
      GROUP BY idVenta
    ) d ON d.idVenta = v.id
    SET v.total = d.tot
    WHERE v.total IS NULL
  `);

  // Ventas sin ningun renglon en ventas_detalle (no deberian existir en
  // circulacion normal, pero por las dudas): el JOIN de arriba no las toca
  // porque no aparecen en la subconsulta agrupada. Quedan en 0 en vez de NULL.
  await knex.raw(`UPDATE ventas SET total = 0 WHERE total IS NULL`);
};

exports.down = async function (knex) {
  const hasTotal = await knex.schema.hasColumn('ventas', 'total');
  if (hasTotal) {
    await knex.schema.alterTable('ventas', table => {
      table.dropColumn('total');
    });
  }
};
