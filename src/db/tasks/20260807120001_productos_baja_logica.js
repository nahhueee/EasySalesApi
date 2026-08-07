// Migration: baja lógica de productos
// Motivo: los productos con historial de precios (producto_precio_historial) o con
//         ventas asociadas (ventas_detalle) no pueden eliminarse físicamente sin
//         romper la FK de historial o perder trazabilidad financiera. Se les aplica
//         baja lógica seteando fechaBaja; el listado y la búsqueda de venta los
//         filtran automáticamente. Mismo patrón que clientes.

exports.up = async function(knex) {
  const yaExiste = await knex.schema.hasColumn('productos', 'fechaBaja');
  if (yaExiste) return;

  await knex.schema.alterTable('productos', table => {
    table.datetime('fechaBaja').nullable().defaultTo(null);
  });
};

exports.down = async function(knex) {
  const existe = await knex.schema.hasColumn('productos', 'fechaBaja');
  if (!existe) return;

  await knex.schema.alterTable('productos', table => {
    table.dropColumn('fechaBaja');
  });
};
