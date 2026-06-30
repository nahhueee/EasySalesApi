exports.up = async function (knex) {

  // ===========================
  // 1. Tabla notas_credito
  // ===========================
  const notasCreditoExists = await knex.schema.hasTable('notas_credito');

  if (!notasCreditoExists) {
    await knex.schema.createTable('notas_credito', table => {
      table.increments('id').primary();
      table.integer('idVenta').unsigned().notNullable();
      table.integer('tipo').notNullable(); // TipoComprobante (objFacturar.ts): NC_A=3 / NC_B=8 / NC_C=13
      table.bigInteger('cae').notNullable();
      table.date('caeVto').notNullable();
      table.integer('ticket').notNullable();
      table.integer('ptoVenta').notNullable();
      table.decimal('neto', 10, 2).notNullable();
      table.decimal('iva', 10, 2).notNullable();
      table.decimal('total', 10, 2).notNullable();
      table.boolean('esParcial').notNullable().defaultTo(false);
      table.dateTime('fecha').notNullable();
      table.string('motivo', 200).nullable();

      table.foreign('idVenta').references('ventas.id');
      // Acceso central: sumar lo ya acreditado de una venta (disponibilidad para nueva NC,
      // y para decidir en el frontend si se muestra "Emitir NC" o "Eliminar").
      table.index('idVenta');
    });
  }

  // ===========================
  // 2. Tabla notas_credito_detalle (NC parcial)
  // ===========================
  const detalleExists = await knex.schema.hasTable('notas_credito_detalle');

  if (!detalleExists) {
    await knex.schema.createTable('notas_credito_detalle', table => {
      table.increments('id').primary();
      table.integer('idNotaCredito').unsigned().notNullable();
      // ventas_detalle tiene PK compuesta (id, idVenta) sin indice unico propio sobre "id" solo,
      // y el resto del codigo tampoco declara FK sobre ventas_detalle (ver idProducto en
      // presupuestos_detalle) -> se guarda sin constraint, mismo criterio.
      table.integer('idVentaDetalle').unsigned().notNullable();
      table.integer('idProducto').unsigned().notNullable();
      table.string('nomProd', 100).notNullable();
      table.decimal('cantidad', 10, 2).notNullable();
      table.decimal('precio', 10, 2).notNullable();

      table.foreign('idNotaCredito').references('notas_credito.id');
      // Acceso central: validar sobre-acreditacion por linea de venta ya acreditada
      table.index('idVentaDetalle');
    });
  }
};

exports.down = async function (knex) {

  // Orden inverso por FKs
  const detalleExists = await knex.schema.hasTable('notas_credito_detalle');
  if (detalleExists) {
    await knex.schema.dropTable('notas_credito_detalle');
  }

  const notasCreditoExists = await knex.schema.hasTable('notas_credito');
  if (notasCreditoExists) {
    await knex.schema.dropTable('notas_credito');
  }
};
