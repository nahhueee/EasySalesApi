exports.up = async function(knex) {

  // ===========================
  // 1. Tabla presupuestos
  // ===========================
  const presupuestosExists = await knex.schema.hasTable('presupuestos');

  if (!presupuestosExists) {
    await knex.schema.createTable('presupuestos', table => {
      table.increments('id').primary();
      table.integer('idCliente').notNullable();
      table.integer('idUsuario').notNullable();
      table.integer('idCaja').nullable();          // NULL si se creó fuera de una caja
      table.date('fecha').notNullable();
      table.date('validezHasta').notNullable();
      table.decimal('total', 10, 2).notNullable();
      table.enu('estado', ['vigente', 'convertido', 'anulado', 'vencido'])
           .notNullable()
           .defaultTo('vigente');
      table.integer('idVentaGenerada').nullable(); // Se setea al convertir

      table.foreign('idCliente').references('clientes.id');
      table.foreign('idVentaGenerada').references('ventas.id');
    });
  }

  // ===========================
  // 2. Tabla presupuestos_detalle
  // ===========================
  const detalleExists = await knex.schema.hasTable('presupuestos_detalle');

  if (!detalleExists) {
    await knex.schema.createTable('presupuestos_detalle', table => {
      table.increments('id').primary();
      table.integer('idPresupuesto').notNullable();
      table.integer('idProducto').notNullable();    // Solo productos reales — los ad-hoc (vario, soloPrecio) no se presupuestan
      table.string('nomProd', 200).notNullable();  // Snapshot del nombre
      table.decimal('cantidad', 10, 3).notNullable();
      table.decimal('precio', 10, 2).notNullable(); // Snapshot del precio cotizado
      table.decimal('costo', 10, 2).notNullable();
      table.decimal('total', 10, 2).notNullable();

      table.foreign('idPresupuesto').references('presupuestos.id');
    });
  }
};

exports.down = async function(knex) {

  // Orden inverso por FKs
  const detalleExists = await knex.schema.hasTable('presupuestos_detalle');
  if (detalleExists) {
    await knex.schema.dropTable('presupuestos_detalle');
  }

  const presupuestosExists = await knex.schema.hasTable('presupuestos');
  if (presupuestosExists) {
    await knex.schema.dropTable('presupuestos');
  }
};
