// Migration: tabla productos_proveedores (Fase 3, PR 3.1 -- multi-proveedor por producto).
//
// Patron "tabla nueva + espejo en la columna vieja" (mismo criterio que multiprecio,
// project_multiprecio_decisiones Opcion A): productos.idProveedor NO se toca en esta
// migracion. Sigue siendo el proveedor "principal" que lee todo el codigo existente
// (productosRepository, faltantes, exportProductosService, relacionar-productos, etc. --
// relevamiento completo en documentos/handoff_repuestos_fases1_2_3.md, seccion Fase 3).
// Lo nuevo (PR 3.2 en adelante) lee/escribe esta tabla y mantiene el espejo sincronizado
// en la misma transaccion. Migracion incremental, no big bang.
//
// unsigned OBLIGATORIO en ambas FK: productos.id y proveedores.id son `increments()`
// (INT UNSIGNED) -- misma trampa ya documentada en 20260817120000_productos_id_proveedor.js
// y 20260808130000_cajas_movimientos_id_proveedor_movimiento.js.
//
// Sin onDelete en ninguna FK (RESTRICT por default de MySQL/InnoDB), mismo criterio que
// proveedor_cuenta_movimientos.idProveedor: ni productos ni proveedores se borran
// fisicamente en esta app (ambos usan baja logica via fechaBaja), asi que RESTRICT es la
// opcion segura -- si alguna vez se intenta un borrado fisico manual, mejor que falle
// ruidosamente a que deje productos_proveedores con filas huerfanas silenciosas.
//
// UNIQUE (idProducto, idProveedor): un producto no puede tener el mismo proveedor
// cargado dos veces. Ese mismo indice ya cubre las consultas "proveedores de un
// producto" (idProducto es el prefijo izquierdo); se agrega un indice aparte sobre
// idProveedor solo para la consulta inversa "productos de un proveedor" (Fase 4 --
// matcheo de listas de precios por codigoProveedor).
//
// esPrincipal NOT NULL DEFAULT false: el backfill de abajo es el unico lugar que lo
// pone en true (el proveedor que ya estaba en productos.idProveedor). PR 3.2 es
// responsable de mantener como invariante que a lo sumo un proveedor por producto
// tenga esPrincipal=true, y de escribirlo siempre junto con el espejo en
// productos.idProveedor dentro de la misma transaccion -- nunca uno sin el otro
// (documentos/handoff_repuestos_fases1_2_3.md, PR 3.2).
//
// Handoff: documentos/handoff_repuestos_fases1_2_3.md -- Fase 3, PR 3.1.

exports.up = async function (knex) {
  const existeTabla = await knex.schema.hasTable('productos_proveedores');

  if (!existeTabla) {
    await knex.schema.createTable('productos_proveedores', table => {
      table.increments('id').primary();
      table.integer('idProducto').unsigned().notNullable();
      table.integer('idProveedor').unsigned().notNullable();
      table.string('codigoProveedor', 40).nullable();
      table.decimal('costo', 10, 2).nullable();
      table.boolean('esPrincipal').notNullable().defaultTo(false);
      table.datetime('fechaActualizacion').nullable();

      table.foreign('idProducto').references('productos.id');
      table.foreign('idProveedor').references('proveedores.id');
      table.unique(['idProducto', 'idProveedor']);
      table.index('idProveedor');
    });

    // Backfill: un producto con idProveedor asignado hoy pasa a tener una fila en la
    // tabla nueva, marcada como principal -- consistente con lo que ya muestra toda la
    // app (grilla, modal, faltantes) para ese producto.
    await knex.raw(`
      INSERT INTO productos_proveedores (idProducto, idProveedor, esPrincipal, fechaActualizacion)
      SELECT id, idProveedor, 1, NOW()
      FROM productos
      WHERE idProveedor IS NOT NULL
    `);
  }
};

exports.down = async function (knex) {
  // productos.idProveedor nunca se toco en este up(): no hay nada que restaurar ahi,
  // solo se elimina la tabla nueva.
  await knex.schema.dropTableIfExists('productos_proveedores');
};
