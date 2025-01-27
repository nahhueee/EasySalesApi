/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('prueba', (table) => {
        table.string('nombre', 30).primary; 
        table.date('fecha')       
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
//Rollback
exports.down = function(knex) {
    return knex.schema.dropTable('prueba'); 
};
