/**
 * Migration: trazabilidad de edición de presupuestos
 * Al implementar la edición de presupuestos (PUT /presupuestos/editar/:id) se
 * necesita registrar cuándo y quién hizo la última modificación, dado el foco
 * del proyecto en auditabilidad de movimientos financieros.
 */

// Guarda de idempotencia (Fase 3.1-B): la migration base crea el schema final, que ya
// incluye estas columnas. No cambia el efecto donde esta migration ya corrió.
exports.up = async function (knex) {
  const tieneFecha = await knex.schema.hasColumn('presupuestos', 'fechaModificacion');
  const tieneUsuario = await knex.schema.hasColumn('presupuestos', 'idUsuarioModifico');
  if (tieneFecha && tieneUsuario) return;
  await knex.schema.table('presupuestos', function (table) {
    if (!tieneFecha) table.dateTime('fechaModificacion').nullable().defaultTo(null);
    if (!tieneUsuario) table.integer('idUsuarioModifico').unsigned().nullable().defaultTo(null);
  });
};

exports.down = function (knex) {
  return knex.schema.table('presupuestos', function (table) {
    table.dropColumn('fechaModificacion');
    table.dropColumn('idUsuarioModifico');
  });
};
