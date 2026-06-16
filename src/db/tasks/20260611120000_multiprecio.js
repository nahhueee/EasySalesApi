exports.up = async function(knex) {

  // ===========================
  // 1. Tabla listas_precio
  // ===========================
  const listasExists = await knex.schema.hasTable('listas_precio');

  if (!listasExists) {
    await knex.schema.createTable('listas_precio', table => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable();
      table.boolean('esDefault').notNullable().defaultTo(false);
      table.boolean('activa').notNullable().defaultTo(true);
    });

    // Seed: lista Minorista por defecto
    await knex('listas_precio').insert({ nombre: 'Minorista', esDefault: true, activa: true });
  }

  // ===========================
  // 2. Tabla productos_precios
  // ===========================
  const preciosExists = await knex.schema.hasTable('productos_precios');

  if (!preciosExists) {
    await knex.schema.createTable('productos_precios', table => {
      table.increments('id').primary();
      table.integer('idProducto').unsigned().notNullable();
      table.integer('idLista').unsigned().notNullable();
      table.string('tipoPrecio', 1).notNullable().defaultTo('$');
      table.decimal('costo', 10, 2).notNullable().defaultTo(0);
      table.decimal('precio', 10, 2).notNullable().defaultTo(0);
      table.decimal('porcentaje', 10, 2).nullable();
      table.integer('redondeo').notNullable().defaultTo(0);
      table.boolean('sumarIva').notNullable().defaultTo(false);

      table.unique(['idProducto', 'idLista']);
      table.foreign('idProducto').references('productos.id');
      table.foreign('idLista').references('listas_precio.id');
    });

    // Migrar precios existentes: copiar de productos a productos_precios con lista Minorista (id=1)
    const lista = await knex('listas_precio').where({ esDefault: true }).first();
    if (lista) {
      const productos = await knex('productos').select(
        'id', 'tipoPrecio', 'costo', 'precio', 'porcentaje', 'redondeo', 'sumarIva'
      );

      if (productos.length > 0) {
        const rows = productos.map(p => ({
          idProducto: p.id,
          idLista:    lista.id,
          tipoPrecio: p.tipoPrecio || '$',
          costo:      p.costo      || 0,
          precio:     p.precio     || 0,
          porcentaje: p.porcentaje || null,
          redondeo:   p.redondeo   || 0,
          sumarIva:   p.sumarIva   ? 1 : 0,
        }));

        await knex('productos_precios').insert(rows);
      }
    }
  }
};

exports.down = async function(knex) {
  const preciosExists = await knex.schema.hasTable('productos_precios');
  if (preciosExists) {
    await knex.schema.dropTable('productos_precios');
  }

  const listasExists = await knex.schema.hasTable('listas_precio');
  if (listasExists) {
    await knex.schema.dropTable('listas_precio');
  }
};
