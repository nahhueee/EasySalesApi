/**
 * Migration: telefono de cliente
 * Sumamos telefono como campo opcional del cliente, mismo patrón que direccion
 * (20260711130000_clientes_direccion.js) y que proveedores.telefono. Se usa para armar
 * el link de WhatsApp al enviar factura/presupuesto (wa.me) — siempre editable a mano,
 * no se completa ni valida contra ningún padrón.
 */

exports.up = async function (knex) {
  const hasTelefono = await knex.schema.hasColumn('clientes', 'telefono');
  if (!hasTelefono) {
    await knex.schema.alterTable('clientes', table => {
      table.string('telefono', 30).nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasTelefono = await knex.schema.hasColumn('clientes', 'telefono');
  if (hasTelefono) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('telefono');
    });
  }
};
