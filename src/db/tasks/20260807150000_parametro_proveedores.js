// Migration: flag server-side para el módulo de Proveedores (Fase 1).
//
// Server-side en `parametros` a propósito, no localStorage/SetStorageOtros como el resto de
// los flags de "otros" (vencimientos, iva, presupuestos, listasPrecios): esos son ajustes de
// UI per-máquina, pero Proveedores va a crear datos reales (altas, pagos). Un flag per-máquina
// generaría el bug de "lo activé en la oficina pero en el mostrador no se ve".
//
// Default 'false': módulo opt-in, no cambia nada para quien no lo activa.
//
// Handoff: documentos/handoff_proveedores_fase0_1.md — PR 2.

exports.up = async function (knex) {
  const existeRegistro = await knex('parametros').where({ clave: 'proveedores' }).first();

  if (!existeRegistro) {
    await knex('parametros').insert({ clave: 'proveedores', valor: 'false' });
  }
};

exports.down = async function (knex) {
  await knex('parametros').where({ clave: 'proveedores' }).del();
};
