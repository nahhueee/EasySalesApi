// Migration: alta de la tabla `proveedores` (Fase 1 del módulo de Proveedores).
//
// Decisiones de diseño (documentos/plan_proveedores.md §4.1):
// - Un solo campo `cuit`, sin tipoDocumento/nroDocumento como en clientes: un proveedor
//   siempre es una empresa, y no se le emite comprobante (no hace falta condicionIva).
// - `diasVisita` es texto libre a propósito ("Lunes y jueves"): estructurarlo en días
//   sueltos sería sobreingeniería para un dato que solo se muestra, nunca se filtra.
// - `fechaBaja` (baja lógica) desde el día 1: a clientes le hizo falta una migración aparte
//   (20260710000000_clientes_baja_logica.js) para agregarla después, no repetir el error acá.
//
// Handoff: documentos/handoff_proveedores_fase0_1.md — PR 3.

exports.up = async function (knex) {
  const existeTabla = await knex.schema.hasTable('proveedores');

  if (!existeTabla) {
    await knex.schema.createTable('proveedores', table => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable();
      table.string('razonSocial', 150).nullable();
      table.string('cuit', 13).nullable();
      table.string('telefono', 30).nullable();
      table.string('email', 100).nullable();
      table.string('direccion', 200).nullable();
      table.string('diasVisita', 60).nullable();
      table.string('observaciones', 250).nullable();
      table.datetime('fechaBaja').nullable();
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('proveedores');
};
