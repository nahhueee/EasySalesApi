/**
 * Migration: snapshot del receptor en los comprobantes fiscales
 *
 * Hasta ahora el nombre/direccion del receptor impresos en la factura y en la nota de
 * credito se derivaban de venta.cliente en tiempo de impresion (comprobanteService y
 * notaCreditoService). Eso trae dos problemas:
 *
 *  1. Al facturar una venta ya registrada (listado de ventas / cuenta corriente), el
 *     cliente elegido en el modal de facturacion se descartaba: la venta seguia con su
 *     idCliente original (tipicamente 1 = Consumidor Final) y el comprobante salia a
 *     nombre de "Consumidor Final" aunque a ARCA se le hubiera declarado el DNI/CUIT
 *     del cliente real.
 *  2. Un comprobante emitido es un documento inmutable, pero al derivar el receptor de
 *     la tabla clientes, renombrar o editar un cliente cambiaba retroactivamente lo que
 *     imprimen sus facturas viejas.
 *
 * Guardamos el receptor congelado en el propio comprobante. Los comprobantes historicos
 * quedan con las columnas en NULL y siguen cayendo al fallback venta.cliente, asi que no
 * hace falta backfill ni cambia lo que imprimen hoy.
 *
 * Solo ventas_factura: la nota de credito no duplica el snapshot. Una NC siempre acredita
 * una factura y su read-path (NotaCreditoService.ObtenerImpresion) ya lee esa factura, de
 * modo que hereda el receptor congelado. Duplicarlo en notas_credito seria un segundo lugar
 * que mantener sincronizado, y ademas abriria la puerta a que NC y factura difieran, cosa
 * que fiscalmente no debe pasar.
 */

exports.up = async function (knex) {
  const hasReceptor = await knex.schema.hasColumn('ventas_factura', 'receptorNombre');
  if (!hasReceptor) {
    await knex.schema.alterTable('ventas_factura', table => {
      table.string('receptorNombre', 150).nullable();
      table.string('receptorDireccion', 150).nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasReceptor = await knex.schema.hasColumn('ventas_factura', 'receptorNombre');
  if (hasReceptor) {
    await knex.schema.alterTable('ventas_factura', table => {
      table.dropColumn('receptorNombre');
      table.dropColumn('receptorDireccion');
    });
  }
};
