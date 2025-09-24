export async function up(knex) {
  await knex.schema.alterTable('productos', function (table) {
    table.integer('sumarIva').defaultTo(0);
  });
}

export async function down(knex) {
  await knex.schema.alterTable('productos', function (table) {
    table.dropColumn('sumarIva');
  });
}
