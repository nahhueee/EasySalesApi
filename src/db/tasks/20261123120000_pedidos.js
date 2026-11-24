/**
 * Migration: Pedidos de clientes (PR A, sin seña). Ver documentos/handoff_pedidos.md §3.
 *
 * - `pedidos`: compromiso de venta futura. Entidad propia (no se reusa `presupuestos` ni `ventas`).
 * - `pedidos_detalle`: espejo de `presupuestos_detalle` (snapshot de nombre, precio y costo).
 * - `pedidos_estados_historial`: cada cambio de estado (quién, cuándo, de qué a qué).
 *
 * Tipos (architecture.md §12): clientes.id, ventas.id y productos.id son INT UNSIGNED;
 * cajas.id es INT CON signo, así que idCaja va sin unsigned (si no, la FK falla por tipo distinto).
 * idUsuario / idUsuarioModifico / idUsuarioCancelo van SIN FK: son auditoría y tienen que
 * sobrevivir al borrado del usuario (§12.3.1).
 * Las fechas de auditoría las pone MySQL (DEFAULT CURRENT_TIMESTAMP / NOW()), nunca Node (§11.6).
 * Sin CHARSET/COLLATE explícitos (§13). Idempotente (hasTable). `down` en orden inverso.
 *
 * - Preferencia `pedidos` (configuración del comercio, Fase 3.4-P): se inserta con 'false'. NO con el centinela
 *   '__sin_migrar__' ni sin fila: una clave "sin migrar" hace que la primera terminal que arranque importe su
 *   localStorage y dispare el aviso único al admin ("configuración importada") en comercios que ya andaban.
 *
 * La tabla de pagos (seña) y la columna destinoSenia se crean en la migration del PR B.
 */

const CLAVE_PEDIDOS = 'pedidos';

exports.up = async function (knex) {

  if (!(await knex.schema.hasTable('pedidos'))) {
    await knex.schema.createTable('pedidos', (table) => {
      table.increments('id');                                               // INT UNSIGNED AUTO_INCREMENT PK
      table.integer('idCliente').unsigned().notNullable();
      table.integer('idUsuario').unsigned().notNullable();                  // sin FK
      table.integer('idCaja').nullable();                                   // INT con signo, igual que cajas.id
      table.date('fecha').notNullable();
      table.date('fechaEntregaEstimada').nullable();
      table.decimal('total', 10, 2).notNullable();
      table.enu('estado', ['pendiente', 'en_proceso', 'listo', 'entregado', 'cancelado'])
           .notNullable()
           .defaultTo('pendiente');
      table.string('observaciones', 500).nullable();
      table.string('contactoNombre', 100).nullable();
      table.string('contactoTelefono', 30).nullable();
      table.integer('idVentaGenerada').unsigned().nullable();
      table.datetime('fechaModificacion').nullable();
      table.integer('idUsuarioModifico').unsigned().nullable();             // sin FK
      table.datetime('fechaCancelacion').nullable();
      table.integer('idUsuarioCancelo').unsigned().nullable();              // sin FK
      table.string('motivoCancelacion', 255).nullable();

      table.index(['estado'], 'idx_pedidos_estado');
      table.index(['idCliente'], 'idx_pedidos_idCliente');
      table.index(['fecha'], 'idx_pedidos_fecha');
      table.index(['idVentaGenerada'], 'idx_pedidos_idVentaGenerada');

      table.foreign('idCliente', 'fk_pedidos_idCliente').references('clientes.id');
      table.foreign('idCaja', 'fk_pedidos_idCaja').references('cajas.id');
      table.foreign('idVentaGenerada', 'fk_pedidos_idVentaGenerada').references('ventas.id');
    });
  }

  if (!(await knex.schema.hasTable('pedidos_detalle'))) {
    await knex.schema.createTable('pedidos_detalle', (table) => {
      table.increments('id');
      table.integer('idPedido').unsigned().notNullable();
      table.integer('idProducto').unsigned().notNullable();
      table.string('nomProd', 200).notNullable();                           // snapshot del nombre
      table.decimal('cantidad', 10, 3).notNullable();
      table.decimal('precio', 10, 2).notNullable();                         // snapshot del precio pactado
      table.decimal('costo', 10, 2).notNullable();
      table.decimal('total', 10, 2).notNullable();

      table.index(['idPedido'], 'idx_pedidos_detalle_idPedido');
      table.index(['idProducto'], 'idx_pedidos_detalle_idProducto');

      table.foreign('idPedido', 'fk_pedidos_detalle_idPedido').references('pedidos.id');
      table.foreign('idProducto', 'fk_pedidos_detalle_idProducto').references('productos.id');
    });
  }

  if (!(await knex.schema.hasTable('pedidos_estados_historial'))) {
    await knex.schema.createTable('pedidos_estados_historial', (table) => {
      table.increments('id');
      table.integer('idPedido').unsigned().notNullable();
      table.string('estadoAnterior', 20).nullable();                        // NULL en la creación
      table.string('estadoNuevo', 20).notNullable();
      table.integer('idUsuario').unsigned().nullable();                     // sin FK
      table.datetime('fecha').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
      table.string('observacion', 255).nullable();

      table.index(['idPedido', 'id'], 'idx_pedidos_historial_idPedido');

      table.foreign('idPedido', 'fk_pedidos_historial_idPedido').references('pedidos.id');
    });
  }

  const preferencia = await knex('parametros').where({ clave: CLAVE_PEDIDOS }).first();
  if (!preferencia) {
    await knex('parametros').insert({ clave: CLAVE_PEDIDOS, valor: 'false' });
  }
};

exports.down = async function (knex) {
  await knex('parametros').where({ clave: CLAVE_PEDIDOS }).del();
  await knex.schema.dropTableIfExists('pedidos_estados_historial');
  await knex.schema.dropTableIfExists('pedidos_detalle');
  await knex.schema.dropTableIfExists('pedidos');
};
