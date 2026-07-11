/**
 * Migration: direccion de cliente
 * Sumamos direccion como campo opcional del cliente. Se puede completar a mano en el
 * alta/edicion, o precargar como sugerencia desde la consulta al padron de ARCA
 * (domicilioFiscal.direccion en ws_sr_constancia_inscripcion — ver padronAfipMapper.ts).
 * Igual que el resto de los datos fiscales, es siempre editable y nunca autoritativa.
 */

exports.up = async function (knex) {
  const hasDireccion = await knex.schema.hasColumn('clientes', 'direccion');
  if (!hasDireccion) {
    await knex.schema.alterTable('clientes', table => {
      table.string('direccion', 150).nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasDireccion = await knex.schema.hasColumn('clientes', 'direccion');
  if (hasDireccion) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('direccion');
    });
  }
};
