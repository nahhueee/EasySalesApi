/**
 * Migration: baja lógica de usuarios (Fase 3.2-C, ver documentos/handoff_fase3_2cd_usuarios_baja_y_visor_eventos.md).
 *
 * - usuarios.fechaBaja DATETIME NULL: NULL = activo. Un usuario dado de baja no se reactiva
 *   (si hace falta, se crea uno nuevo) y conserva toda su auditoría.
 * - Idempotente (hasColumn). Sin CHARSET/COLLATE explícitos (architecture.md §13).
 */

const TABLA = 'usuarios';
const COLUMNA = 'fechaBaja';

exports.up = async function (knex) {
  if (await knex.schema.hasColumn(TABLA, COLUMNA)) return;

  await knex.schema.alterTable(TABLA, (table) => {
    table.datetime(COLUMNA).nullable().defaultTo(null);
  });
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn(TABLA, COLUMNA))) return;

  await knex.schema.alterTable(TABLA, (table) => {
    table.dropColumn(COLUMNA);
  });
};
