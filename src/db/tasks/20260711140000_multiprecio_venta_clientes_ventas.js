exports.up = async function(knex) {

  // ===========================
  // 1. clientes.idLista
  // ===========================
  const clientesTieneIdLista = await knex.schema.hasColumn('clientes', 'idLista');

  if (!clientesTieneIdLista) {
    await knex.schema.alterTable('clientes', table => {
      table.integer('idLista').unsigned().nullable();
      table.foreign('idLista').references('listas_precio.id');
    });
  }

  // ===========================
  // 2. ventas.idLista
  // ===========================
  const ventasTieneIdLista = await knex.schema.hasColumn('ventas', 'idLista');

  if (!ventasTieneIdLista) {
    await knex.schema.alterTable('ventas', table => {
      table.integer('idLista').unsigned().nullable();
      table.foreign('idLista').references('listas_precio.id');
    });
  }
};

exports.down = async function(knex) {
  const ventasTieneIdLista = await knex.schema.hasColumn('ventas', 'idLista');
  if (ventasTieneIdLista) {
    await knex.schema.alterTable('ventas', table => {
      table.dropForeign('idLista');
      table.dropColumn('idLista');
    });
  }

  const clientesTieneIdLista = await knex.schema.hasColumn('clientes', 'idLista');
  if (clientesTieneIdLista) {
    await knex.schema.alterTable('clientes', table => {
      table.dropForeign('idLista');
      table.dropColumn('idLista');
    });
  }
};
