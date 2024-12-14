/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
    return knex.schema.createTable('backups', (table) => {
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
    return knex.schema.dropTable('backups'); 
};
