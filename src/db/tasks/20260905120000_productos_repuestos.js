// Migration: campos de repuestos (marca, vehiculo, aplicacion) + flag server-side 'repuestos'.
//
// Los tres campos van detras del flag `repuestos` en `parametros`, mismo criterio que
// Proveedores (20260807150000_parametro_proveedores.js): con el flag apagado, el modal, la
// grilla y la busqueda tienen que comportarse exactamente igual que antes.
//
// `marca` es en realidad un campo universal (lo necesita cualquier rubro), pero por ahora
// queda detras del flag para no tocar el modal de nadie mas sin que lo pida - sacarlo del
// flag el dia que otro cliente lo necesite es trivial porque los datos ya estan.
//
// Tamanios medidos sobre las 1927 filas reales del primer cliente (documentos/
// handoff_repuestos_fases1_2_3.md): marca max 20, vehiculo max 54, aplicacion max 257 - los
// tamanios de abajo tienen margen.
//
// Handoff: documentos/handoff_repuestos_fases1_2_3.md - Fase 2, PR 2.1.

exports.up = async function (knex) {
  const tieneMarca = await knex.schema.hasColumn('productos', 'marca');
  const tieneVehiculo = await knex.schema.hasColumn('productos', 'vehiculo');
  const tieneAplicacion = await knex.schema.hasColumn('productos', 'aplicacion');

  if (!tieneMarca || !tieneVehiculo || !tieneAplicacion) {
    await knex.schema.alterTable('productos', table => {
      if (!tieneMarca) table.string('marca', 40).nullable();
      if (!tieneVehiculo) table.string('vehiculo', 80).nullable();
      if (!tieneAplicacion) table.string('aplicacion', 300).nullable();
    });
  }

  const existeParametro = await knex('parametros').where({ clave: 'repuestos' }).first();
  if (!existeParametro) {
    await knex('parametros').insert({ clave: 'repuestos', valor: 'false' });
  }
};

exports.down = async function (knex) {
  const tieneMarca = await knex.schema.hasColumn('productos', 'marca');
  const tieneVehiculo = await knex.schema.hasColumn('productos', 'vehiculo');
  const tieneAplicacion = await knex.schema.hasColumn('productos', 'aplicacion');

  if (tieneMarca || tieneVehiculo || tieneAplicacion) {
    await knex.schema.alterTable('productos', table => {
      if (tieneMarca) table.dropColumn('marca');
      if (tieneVehiculo) table.dropColumn('vehiculo');
      if (tieneAplicacion) table.dropColumn('aplicacion');
    });
  }

  await knex('parametros').where({ clave: 'repuestos' }).del();
};
