exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('cuenta_corriente_movimientos');

  if (!exists) {
    await knex.schema.createTable('cuenta_corriente_movimientos', table => {
      table.increments('id').primary();
      table.integer('idCliente').unsigned().notNullable();
      table.date('fecha').notNullable();
      table.string('hora', 5).notNullable();
      table.enu('tipo', ['apertura', 'venta', 'entrega', 'nota_credito', 'ajuste']).notNullable();
      table.string('descripcion', 200).nullable();
      table.decimal('debe', 10, 2).notNullable().defaultTo(0);
      table.decimal('haber', 10, 2).notNullable().defaultTo(0);
      table.integer('idReferencia').nullable();
      table.decimal('saldo', 10, 2).notNullable();

      table.foreign('idCliente').references('clientes.id');
      // Indice compuesto: es el acceso central de RegistrarMovimiento
      // (ultimo saldo de un cliente) y de la futura pantalla de ledger.
      table.index(['idCliente', 'id']);
    });
  }
};

exports.down = async function (knex) {
  const exists = await knex.schema.hasTable('cuenta_corriente_movimientos');
  if (exists) {
    await knex.schema.dropTable('cuenta_corriente_movimientos');
  }
};
