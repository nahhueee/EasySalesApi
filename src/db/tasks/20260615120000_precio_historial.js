exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('producto_precio_historial');
  if (exists) return;

  await knex.schema.createTable('producto_precio_historial', table => {
    table.increments('id').primary();
    table.integer('idProducto').unsigned().notNullable();
    table.integer('idLista').unsigned().notNullable();
    table.string('tipoPrecio', 1).notNullable();
    table.decimal('porcentaje', 10, 2).nullable();
    table.decimal('costo', 10, 2).notNullable().defaultTo(0);
    table.boolean('sumarIva').notNullable().defaultTo(false);
    table.decimal('precio', 10, 2).notNullable().defaultTo(0);
    table.integer('redondeo').notNullable().defaultTo(0);
    table.datetime('fecha').notNullable();
    table.integer('idUsuario').unsigned().notNullable().defaultTo(0);
    table.string('origen', 20).notNullable(); // 'ALTA' | 'EDICION' | 'CAMBIO_MASIVO'

    table.index(['idProducto', 'idLista', 'fecha'], 'idx_historial_producto_lista_fecha');
    table.foreign('idProducto').references('id').inTable('productos');
    table.foreign('idLista').references('id').inTable('listas_precio');
  });
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('producto_precio_historial');
};
