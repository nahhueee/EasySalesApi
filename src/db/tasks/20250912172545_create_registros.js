/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Crear tabla registros
  await knex.schema.dropTableIfExists("registros");
  await knex.schema.createTable("registros", (table) => {
    table.increments("id").primary().unsigned();
    table.string("descripcion", 80);
    table.integer("prioridad");
    table.decimal("total", 10, 2);
  });

  // Crear tabla registros_detalle
  await knex.schema.dropTableIfExists("registros_detalle");
  await knex.schema.createTable("registros_detalle", (table) => {
    table.increments("id").primary().unsigned();
    table.integer("idRegistro");
    table.string("accion", 6);
    table.decimal("monto", 10, 2);
    table.string("observacion", 80);
    table.date("fecha");
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Eliminar tablas
  await knex.schema.dropTableIfExists("registros_detalle");
  await knex.schema.dropTableIfExists("registros");
};
