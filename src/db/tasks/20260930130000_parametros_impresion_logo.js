/**
 * Migration: logo del local en comprobantes (Preferencias > Impresión)
 * - logo: NOMBRE del archivo en la carpeta upload (logo-<timestamp>.png), no un path — ver
 *   services/logoService.ts. NULL = sin logo.
 * - mostrarLogo: oculta el logo sin borrarlo (mismo criterio que mostrarDireccion/Telefono/Mensaje).
 * - mostrarNombre: oculta el nombre del local cuando hay logo (muchos logos ya traen el nombre y
 *   saldría duplicado). Sin logo el nombre se imprime siempre: ver resolverPersonalizacion().
 * Defaults = comportamiento actual.
 */

const TABLA = 'parametros_impresion';

const COLUMNAS = {
  logo:          (t) => t.string('logo', 100).nullable(),
  mostrarLogo:   (t) => t.boolean('mostrarLogo').notNullable().defaultTo(true),
  mostrarNombre: (t) => t.boolean('mostrarNombre').notNullable().defaultTo(true),
};

exports.up = async function (knex) {
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
