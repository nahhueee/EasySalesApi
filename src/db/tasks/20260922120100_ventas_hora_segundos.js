/**
 * Migration: segundos en ventas.hora
 * ventas.hora se guardaba como "HH:MM" (VARCHAR(5)) -- dos ventas separadas por
 * segundos (ej. un reintento tras timeout, ver 20260922120000_ventas_idempotency_key.js)
 * se veian con "la misma hora" en cualquier reporte/ticket, lo que hacia mas dificil
 * diagnosticar duplicados reales. Se amplia a VARCHAR(8) para guardar "HH:MM:SS".
 * MODIFY es seguro de reejecutar (si ya es VARCHAR(8) no cambia nada).
 */

exports.up = async function (knex) {
  await knex.raw("ALTER TABLE ventas MODIFY hora VARCHAR(8)");
};

exports.down = async function (knex) {
  // No se trunca el dato existente (perderia los segundos ya guardados) -- solo
  // se revierte el tamaño de columna declarado.
  await knex.raw("ALTER TABLE ventas MODIFY hora VARCHAR(5)");
};
