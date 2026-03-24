exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('ventas_pagos_detalle', 'idEntrega');

  if (!hasColumn) {
    await knex.schema.alterTable('ventas_pagos_detalle', (table) => {
      table.integer('idEntrega').nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('ventas_pagos_detalle', 'idEntrega');

  if (hasColumn) {
    await knex.schema.alterTable('ventas_pagos_detalle', (table) => {
      table.dropColumn('idEntrega');
    });
  }
};