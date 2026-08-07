/**
 * Migration: baja lógica de clientes
 * Los clientes con movimientos en cuenta corriente no pueden eliminarse
 * físicamente. Se les aplica baja lógica con fechaBaja; el listado los filtra.
 */

exports.up = async function (knex) {
  const yaExiste = await knex.schema.hasColumn('clientes', 'fechaBaja');
  if (yaExiste) return;

  await knex.schema.table('clientes', function (table) {
    table.dateTime('fechaBaja').nullable().defaultTo(null);
  });
};

exports.down = async function (knex) {
  const existe = await knex.schema.hasColumn('clientes', 'fechaBaja');
  if (!existe) return;

  await knex.schema.table('clientes', function (table) {
    table.dropColumn('fechaBaja');
  });
};
