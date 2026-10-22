/**
 * Migration: tabla `eventos` (Fase 3.2-B — auditoría estructurada de los flujos de plata).
 * Ver documentos/handoff_fase3_2b_eventos.md y architecture.md §12.3.
 *
 * - Fuente de verdad de la auditoría. usuarios_movimientos queda como log legacy (doble
 *   escritura durante la transición, hasta que exista el visor 3.2-D).
 * - Sin FK a puestos ni a usuarios: la auditoría tiene que sobrevivir al borrado de ambos
 *   (architecture.md §12.3.1).
 * - fecha la pone MySQL (DEFAULT CURRENT_TIMESTAMP), nunca Node (§11.6).
 * - Sin CHARSET/COLLATE explícitos (regla de architecture.md §13).
 */

const TABLA = 'eventos';

exports.up = async function (knex) {
  if (await knex.schema.hasTable(TABLA)) return;

  await knex.schema.createTable(TABLA, (table) => {
    table.bigIncrements('id');                                   // BIGINT UNSIGNED AUTO_INCREMENT PK
    table.datetime('fecha').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP'));
    table.specificType('idPuesto', 'CHAR(36)').nullable();       // sin FK (§12.3.1)
    table.integer('idUsuario').unsigned().nullable();            // sin FK
    table.string('accion', 40).notNullable();                    // catálogo del handoff §5
    table.string('entidad', 40).notNullable();                   // 'ventas', 'cajas', ...
    table.integer('entidadId').unsigned().nullable();
    table.json('datosAntes').nullable();
    table.json('datosDespues').nullable();
    table.string('descripcion', 255).nullable();                 // texto legible para el visor
    table.index('fecha', 'idx_eventos_fecha');
    table.index(['entidad', 'entidadId'], 'idx_eventos_entidad');
    table.index('idUsuario', 'idx_eventos_idUsuario');
    table.index('idPuesto', 'idx_eventos_idPuesto');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists(TABLA);
};
