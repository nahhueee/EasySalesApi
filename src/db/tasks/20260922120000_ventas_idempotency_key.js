/**
 * Migration: idempotencyKey en ventas
 * Un cliente reportó ventas duplicadas (mismo total, misma hora). Causa raíz: POST
 * /ventas/agregar es un INSERT puro sin ninguna clave de idempotencia -- si la respuesta
 * se pierde/tarda (maquina lenta, red floja) y el front reintenta tras el error, se
 * inserta una segunda venta identica. El front ahora manda un idempotencyKey (UUID) fijo
 * por intento de venta (se genera una vez al abrir el dialogo de registrar-venta y se
 * reusa en los reintentos). El backend usa este indice UNIQUE para devolver la venta ya
 * creada en vez de insertar de nuevo. Ver investigacion 2026-09-22.
 */

exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('ventas', 'idempotencyKey');
  if (!hasColumn) {
    await knex.schema.alterTable('ventas', table => {
      // Nullable: ventas viejas y cualquier insert que no mande la clave (ej. scripts
      // internos) no se ven afectados. unique() permite multiples NULL en MySQL.
      table.string('idempotencyKey', 36).nullable().unique();
    });
  }
};

exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('ventas', 'idempotencyKey');
  if (hasColumn) {
    await knex.schema.alterTable('ventas', table => {
      table.dropUnique(['idempotencyKey']);
      table.dropColumn('idempotencyKey');
    });
  }
};
