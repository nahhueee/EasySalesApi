/**
 * Migration: tabla local `puestos` (Fase 3.2-A — registro de puestos).
 * Ver documentos/handoff_fase3_2a_puestos.md y architecture.md §12.3.1.
 *
 * - puesto = una máquina física que corre el front (UUID v4 persistido por Rust).
 * - Sin FK desde usuarios_movimientos ni desde la futura `eventos`: la auditoría tiene
 *   que sobrevivir al borrado de un puesto.
 * - nombre NULL = mostrar hostname.
 * - Sin CHARSET/COLLATE explícitos (regla de architecture.md §13).
 */

const TABLA = 'puestos';

exports.up = async function (knex) {
  if (await knex.schema.hasTable(TABLA)) return;

  await knex.schema.createTable(TABLA, (table) => {
    table.specificType('id', 'CHAR(36)').notNullable().primary();
    table.string('nombre', 60).nullable();
    table.string('hostname', 100).nullable();
    table.boolean('esServidor').notNullable().defaultTo(false);
    table.datetime('primerVisto').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    table.datetime('ultimoVisto').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    table.string('so', 100).nullable();
    table.string('versionFront', 20).nullable();
    table.string('ipUltima', 45).nullable();
    table.index('ultimoVisto', 'idx_puestos_ultimoVisto');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(TABLA);
};
