/**
 * Migration: trazabilidad de edición de presupuestos
 * Al implementar la edición de presupuestos (PUT /presupuestos/editar/:id) se
 * necesita registrar cuándo y quién hizo la última modificación, dado el foco
 * del proyecto en auditabilidad de movimientos financieros.
 */

exports.up = function (knex) {
  return knex.schema.table('presupuestos', function (table) {
    table.dateTime('fechaModificacion').nullable().defaultTo(null);
    table.integer('idUsuarioModifico').unsigned().nullable().defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.table('presupuestos', function (table) {
    table.dropColumn('fechaModificacion');
    table.dropColumn('idUsuarioModifico');
  });
};
