// Migration: agrega usuarios_movimientos.idPuesto (PR 1, Fase 2 — auditoría real,
// ver documentos/handoff_fase2_correcciones.md y documentos/handoff_pr1_identidad_puesto.md).
//
// Vocabulario (no reabrir, ver architecture.md §1.2, §9.2, §12.3.1, §18.5):
// - terminal = la instalación completa (unidad de licencia). Vive en terminal.json,
//   solo en la PC servidora. No identifica una máquina.
// - puesto = una máquina física que ejecuta el front. Unidad de auditoría real.
//   UUID v4 generado y persistido por el lado Rust (obtener_puesto_id).
//
// Esta migración reemplaza a la versión anterior (usuarios_movimientos_terminal.js), que
// asumía —incorrectamente— que terminal.json identifica una máquina. Se reescribe en vez de
// encadenar una migración aditiva porque se confirmó que la anterior nunca corrió: ni en
// desarrollo, ni en canary, ni en producción. No hay datos que preservar.
//
// Sin FK: la tabla `puestos` recién existe en PR 2, y aun cuando exista no debe haber FK
// acá — la auditoría tiene que sobrevivir al borrado de un puesto.
//
// Arranca en NULL para todo el historial existente y para los call sites que todavía no
// migraron a pasar puesto_id explícito (quedan bajo el fallback de session.json hasta que
// se los toque, uno por uno, en pasadas incrementales — ver Lote 6, arrancó por ventas,
// cuentasCors y cajas, que son los que más importan para trazabilidad financiera).

exports.up = async function (knex) {
  const yaExiste = await knex.schema.hasColumn('usuarios_movimientos', 'idPuesto');
  if (yaExiste) return;

  await knex.schema.alterTable('usuarios_movimientos', table => {
    table.string('idPuesto', 36).nullable();
  });
};

exports.down = async function (knex) {
  const existe = await knex.schema.hasColumn('usuarios_movimientos', 'idPuesto');
  if (!existe) return;

  await knex.schema.alterTable('usuarios_movimientos', table => {
    table.dropColumn('idPuesto');
  });
};
