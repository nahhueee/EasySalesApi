// Migration: productos.idProveedor (Fase 4, PR 8 — reposición por proveedor).
//
// NULL, no 0: a diferencia de idCategoria (que usa 0 + fila sintética "Sin asignar" en el
// front, ver addmod-productos.component.ts:154), acá va NULL real + FK. El patrón de
// idCategoria=0 no se puede combinar con una FK real (0 no existe en categorias tampoco, pero
// esa tabla nunca declaró la FK). No repetir esa inconsistencia acá — documentado en
// documentos/handoff_proveedores_fase3_4.md, PR 8.
//
// unsigned OBLIGATORIO: proveedores.id es `increments()` (INT UNSIGNED) — misma trampa que ya
// documentó 20260808130000_cajas_movimientos_id_proveedor_movimiento.js.
//
// FK en RESTRICT (default de knex) sería incorrecto acá: dar de baja un proveedor con
// productos asignados NO debe fallar (baja lógica, documentos/handoff_proveedores_fase3_4.md
// PR8 checklist), así que la FK va en ON DELETE SET NULL. En la práctica los proveedores nunca
// se borran físicamente (fechaBaja), pero dejamos la protección igual por si alguna vez se
// permite un borrado físico manual desde la base.

exports.up = async function (knex) {
  const tiene = await knex.schema.hasColumn('productos', 'idProveedor');
  if (!tiene) {
    await knex.schema.alterTable('productos', table => {
      table.integer('idProveedor').unsigned().nullable();
      table.foreign('idProveedor').references('proveedores.id').onDelete('SET NULL');
    });
  }
};

exports.down = async function (knex) {
  const tiene = await knex.schema.hasColumn('productos', 'idProveedor');
  if (tiene) {
    await knex.schema.alterTable('productos', table => {
      table.dropForeign('idProveedor');
      table.dropColumn('idProveedor');
    });
  }
};
