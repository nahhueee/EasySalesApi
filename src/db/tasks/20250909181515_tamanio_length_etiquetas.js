export async function up(knex) {
  await knex.schema.alterTable("etiquetas", (table) => {
    table.string("tamanio", 15).alter();
  });
}

export async function down(knex) {
  await knex.schema.alterTable("etiquetas", (table) => {
    table.string("tamanio", 10).alter();
  });
}
