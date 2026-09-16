// Migration: importaciones_costos + importaciones_costos_detalle (MVP importación de
// precios desde lista de proveedor -- documentos/handoff_importacion_precios_proveedor.md).
//
// Tabla propia y no derivar el deshacer de producto_precio_historial: el historial es
// append-only por lista y no marca qué filas formaron un mismo lote; reconstruir "la fila
// anterior a las de esta importación" es frágil y caro. La tabla explícita cuesta una
// migración y hace el deshacer trivial. El historial se sigue escribiendo igual (lo hace
// importacionCostosRepository.ts vía InsertarHistorialPrecios, con origen 'IMPORTACION').
//
// unsigned OBLIGATORIO en todas las FK -- productos.id y proveedores.id son `increments()`
// (INT UNSIGNED) -- misma trampa ya documentada en 20260817120000_productos_id_proveedor.js
// y 20260908120000_productos_proveedores.js.
//
// Sin onDelete en ninguna FK (RESTRICT por default de MySQL/InnoDB), mismo criterio que
// productos_proveedores: acá nada se borra físicamente.
//
// costoAnterior / precioAnterior nullable a propósito: el caso que dispara este módulo es
// justamente el producto que no tenía precio cargado. Deshacer tiene que poder devolverlo
// a NULL, no a 0.
//
// tipoPrecioAnterior / porcentajeAnterior / redondeoAnterior: AplicarLote no sólo pisa
// costo/precio en productos -- también pisa tipoPrecio/porcentaje/redondeo (mismo espejo que
// ActualizarPrecioPorcentaje). Sin guardar estos tres, Deshacer podía restaurar costo/precio
// viejos pero dejar el producto con un porcentaje/tipoPrecio que nunca existió antes de la
// importación -- bug encontrado en revisión antes de correr la migración. sumarIva NO se
// guarda porque el handoff ya estableció que la importación nunca la toca (no hay nada que
// revertir ahí).

exports.up = async function (knex) {
  const existeCabecera = await knex.schema.hasTable('importaciones_costos');
  if (!existeCabecera) {
    await knex.schema.createTable('importaciones_costos', table => {
      table.increments('id').primary();
      table.integer('idProveedor').unsigned().notNullable();
      table.string('nombreArchivo', 120).nullable();
      table.datetime('fecha').notNullable();
      table.integer('idUsuario').unsigned().notNullable().defaultTo(0);
      table.integer('filasArchivo').notNullable().defaultTo(0);
      table.integer('filasAplicadas').notNullable().defaultTo(0);
      table.boolean('deshecha').notNullable().defaultTo(false);
      table.datetime('fechaDeshecha').nullable();

      table.foreign('idProveedor').references('proveedores.id');
      table.index(['idProveedor', 'fecha']);
    });
  }

  const existeDetalle = await knex.schema.hasTable('importaciones_costos_detalle');
  if (!existeDetalle) {
    await knex.schema.createTable('importaciones_costos_detalle', table => {
      table.increments('id').primary();
      table.integer('idImportacion').unsigned().notNullable();
      table.integer('idProducto').unsigned().notNullable();
      table.string('codigoArchivo', 40).nullable();
      table.decimal('costoAnterior', 10, 2).nullable();
      table.decimal('precioAnterior', 10, 2).nullable();
      table.string('tipoPrecioAnterior', 1).nullable();
      table.decimal('porcentajeAnterior', 10, 2).nullable();
      table.integer('redondeoAnterior').nullable();
      table.decimal('costoNuevo', 10, 2).nullable();
      table.decimal('precioNuevo', 10, 2).nullable();
      table.boolean('creoRelacionProveedor').notNullable().defaultTo(false);

      table.foreign('idImportacion').references('importaciones_costos.id');
      table.foreign('idProducto').references('productos.id');
      table.index('idImportacion');
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('importaciones_costos_detalle');
  await knex.schema.dropTableIfExists('importaciones_costos');
};
