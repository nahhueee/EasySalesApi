/**
 * Migration: recuadro de observaciones en tickets
 * Preferencia (Impresión) para mostrar/ocultar un espacio en blanco al pie del
 * ticket/factura térmica donde el cliente pueda anotar algo a mano. No aplica a A4
 * (ver buildObservaciones/buildDocInterno/buildDocFactura en comprobanteService.ts).
 * Default true para no cambiar el comportamiento actual de quienes ya imprimen.
 */

exports.up = function (knex) {
  return knex.schema.table('parametros_impresion', function (table) {
    table.boolean('mostrarObservaciones').notNullable().defaultTo(true);
  });
};

exports.down = function (knex) {
  return knex.schema.table('parametros_impresion', function (table) {
    table.dropColumn('mostrarObservaciones');
  });
};
