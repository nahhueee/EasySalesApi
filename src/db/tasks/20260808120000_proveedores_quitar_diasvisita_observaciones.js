// Migration: se decidió no usar `diasVisita` ni `observaciones` en Proveedores (2026-08-08,
// a un día de agregarlos en la migración 20260807151500_proveedores.js). Sin datos de
// producción todavía, así que se borran las columnas en vez de dejarlas muertas.
//
// No se edita la migración original: 20260807151500_proveedores.js ya corrió contra la base
// local del usuario, y knex no vuelve a ejecutar una migración ya aplicada aunque se edite el
// archivo — el ALTER TABLE de acá es el único camino que deja limpias tanto una base que ya
// migró como una instalación nueva (crea y en el siguiente paso borra, sin error).

exports.up = async function (knex) {
  const tieneDiasVisita = await knex.schema.hasColumn('proveedores', 'diasVisita');
  const tieneObservaciones = await knex.schema.hasColumn('proveedores', 'observaciones');

  if (tieneDiasVisita || tieneObservaciones) {
    await knex.schema.alterTable('proveedores', table => {
      if (tieneDiasVisita) table.dropColumn('diasVisita');
      if (tieneObservaciones) table.dropColumn('observaciones');
    });
  }
};

exports.down = async function (knex) {
  const tieneDiasVisita = await knex.schema.hasColumn('proveedores', 'diasVisita');
  const tieneObservaciones = await knex.schema.hasColumn('proveedores', 'observaciones');

  await knex.schema.alterTable('proveedores', table => {
    if (!tieneDiasVisita) table.string('diasVisita', 60).nullable();
    if (!tieneObservaciones) table.string('observaciones', 250).nullable();
  });
};
