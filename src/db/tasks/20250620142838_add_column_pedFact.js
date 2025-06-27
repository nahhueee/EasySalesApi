exports.up = function(knex) {
  return knex.schema.table('pedidos_factura', function (table) {
    table.int('condReceptor').defaultTo(true);
  });
};

exports.down = function(knex) {
  return knex.schema.table('pedidos_factura', function (table) {
    table.dropColumn('condReceptor');
  });
};
