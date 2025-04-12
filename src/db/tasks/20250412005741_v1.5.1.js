/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.table('ventas_pago', function(table) {
        table.decimal('descuento', 4, 2).defaultTo(0.00);
        table.decimal('recargo', 4, 2).defaultTo(0.00);
      });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  
};
