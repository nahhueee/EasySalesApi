/**
 * Migration: papel de impresión de etiquetas
 * Sumamos "papel" como campo de la plantilla de etiqueta (A4 / 58mm / 80mm).
 * Hasta ahora las etiquetas solo contemplaban hoja A4 con grillas de columnas
 * (campo "tamanio": GRANDE/MEDIANA/PEQUEÑA/MUY PEQUEÑA). Ese campo sigue existiendo
 * y sigue aplicando solo cuando papel = 'A4'. Para impresoras térmicas de rollo
 * continuo (58mm/80mm) el layout es de una sola columna con tamaño fijo, resuelto
 * en impresion-etiqueta.service.ts, independiente del enum "tamanio".
 *
 * Nullable a propósito: las plantillas existentes quedan con papel = NULL, y tanto
 * el frontend como el servicio de impresión tratan NULL como 'A4' (comportamiento
 * idéntico al actual, sin romper nada en producción).
 */

exports.up = async function (knex) {
  const hasPapel = await knex.schema.hasColumn('etiquetas', 'papel');
  if (!hasPapel) {
    await knex.schema.alterTable('etiquetas', table => {
      table.string('papel', 10).nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasPapel = await knex.schema.hasColumn('etiquetas', 'papel');
  if (hasPapel) {
    await knex.schema.alterTable('etiquetas', table => {
      table.dropColumn('papel');
    });
  }
};
