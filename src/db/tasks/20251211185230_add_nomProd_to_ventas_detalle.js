exports.up = function (knex) {
  return knex.schema.table('ventas_detalle', function (table) {
    table.string('nomProd', 100);
  });
};

exports.down = function (knex) {
  return knex.schema.table('ventas_detalle', function (table) {
    table.dropColumn('nomProd');
  });
};
