// Migration: fondo de proveedores en caja (Fase 2, PR 5).
//
// `cajas.fondoProveedores` es una ETIQUETA INFORMATIVA sobre plata que ya está declarada en
// `inicial` — no es plata adicional. No entra en ninguna suma del arqueo
// (total = inicial + ventas + entradas − salidas, ver models/Caja.ts y cajasRepository
// ObtenerQuery). Solo alimenta el indicador Fondo asignado / Pagado / Disponible.
//
// NULL = el comercio no usa el fondo ⇒ indicador oculto.
// 0    = usa el fondo y lo dejó en cero.
// Son estados distintos, no colapsarlos ni migrar NULL a 0.
//
// Handoff: documentos/handoff_proveedores_fase2.md — PR 5.

exports.up = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas', 'fondoProveedores');
  if (!tiene) {
    await knex.schema.alterTable('cajas', table => {
      table.decimal('fondoProveedores', 10, 2).nullable();
    });
  }
};

exports.down = async function (knex) {
  const tiene = await knex.schema.hasColumn('cajas', 'fondoProveedores');
  if (tiene) {
    await knex.schema.alterTable('cajas', table => {
      table.dropColumn('fondoProveedores');
    });
  }
};
