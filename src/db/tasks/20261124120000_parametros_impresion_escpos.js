/**
 * Migration: impresión térmica directa (ESC/POS). Ver documentos/handoff_impresion_escpos.md §3.
 * Columnas nuevas en parametros_impresion (tabla de una sola fila; la fila existente toma los defaults):
 * - modoImpresion: 'DRIVER' (default, comportamiento de siempre) | 'ESCPOS' (solo aplica a papel 80mm).
 * - escposUmbral: umbral de binarización (más alto = más oscuro).
 * - escposAvance: renglones de papel que avanza antes del corte.
 * - escposAncho: puntos imprimibles (576 = 80mm estándar; algunas térmicas son 512).
 * Idempotente (hasColumn). Sin FKs. Sin CHARSET/COLLATE.
 */

const COLUMNAS = [
  ['modoImpresion', (table) => table.string('modoImpresion', 10).notNullable().defaultTo('DRIVER')],
  ['escposUmbral',  (table) => table.integer('escposUmbral').notNullable().defaultTo(170)],
  ['escposAvance',  (table) => table.integer('escposAvance').notNullable().defaultTo(2)],
  ['escposAncho',   (table) => table.integer('escposAncho').notNullable().defaultTo(576)],
];

exports.up = async function (knex) {
  for (const [nombre, definir] of COLUMNAS) {
    if (!(await knex.schema.hasColumn('parametros_impresion', nombre))) {
      await knex.schema.alterTable('parametros_impresion', definir);
    }
  }
};

exports.down = async function (knex) {
  for (const [nombre] of [...COLUMNAS].reverse()) {
    if (await knex.schema.hasColumn('parametros_impresion', nombre)) {
      await knex.schema.alterTable('parametros_impresion', (table) => table.dropColumn(nombre));
    }
  }
};
