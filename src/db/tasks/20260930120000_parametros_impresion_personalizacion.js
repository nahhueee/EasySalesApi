/**
 * Migration: personalización de comprobantes (Preferencias > Impresión)
 * - telefonoLocal: teléfono a mostrar en el encabezado (dato no fiscal).
 * - mensajeExtra: texto libre al pie ("Gracias por su compra").
 * - textoObservaciones: título editable del recuadro en blanco (Observaciones / Firma / ...).
 * - mostrarDireccion / mostrarTelefono / mostrarMensaje: ocultan el dato sin borrarlo.
 *   Aplican solo a datos NO fiscales: el domicilio fiscal de las facturas no es opcional.
 * Defaults = comportamiento actual, para no cambiar lo que ya imprimen los comercios.
 */

const TABLA = 'parametros_impresion';

// Definición única: sirve para up (crear si falta) y down (borrar si existe).
const COLUMNAS = {
  telefonoLocal:      (t) => t.string('telefonoLocal', 30).nullable(),
  mensajeExtra:       (t) => t.string('mensajeExtra', 200).nullable(),
  textoObservaciones: (t) => t.string('textoObservaciones', 60).notNullable().defaultTo('Observaciones'),
  mostrarDireccion:   (t) => t.boolean('mostrarDireccion').notNullable().defaultTo(true),
  mostrarTelefono:    (t) => t.boolean('mostrarTelefono').notNullable().defaultTo(true),
  mostrarMensaje:     (t) => t.boolean('mostrarMensaje').notNullable().defaultTo(true),
};

exports.up = async function (knex) {
  // Se resuelve antes de alterTable: el callback de knex es síncrono, no admite await adentro.
  const faltantes = [];
  for (const nombre of Object.keys(COLUMNAS)) {
    if (!(await knex.schema.hasColumn(TABLA, nombre))) faltantes.push(nombre);
  }
  if (!faltantes.length) return;

  await knex.schema.alterTable(TABLA, (table) => {
    faltantes.forEach((nombre) => COLUMNAS[nombre](table));
  });
};

exports.down = async function (knex) {
  const existentes = [];
  for (const nombre of Object.keys(COLUMNAS)) {
    if (await knex.schema.hasColumn(TABLA, nombre)) existentes.push(nombre);
  }
  if (!existentes.length) return;

  await knex.schema.alterTable(TABLA, (table) => {
    existentes.forEach((nombre) => table.dropColumn(nombre));
  });
};
