/**
 * Migration: baja lógica de clientes
 * Los clientes con movimientos en cuenta corriente no pueden eliminarse
 * físicamente. Se les aplica baja lógica con fechaBaja; el listado los filtra.
 */

exports.up = function (knex) {
  return knex.schema.table('clientes', function (table) {
    table.dateTime('fechaBaja').nullable().defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.table('clientes', function (table) {
    table.dropColumn('fechaBaja');
  });
};
