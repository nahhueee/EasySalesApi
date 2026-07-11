// Migration: agrega "CUENTA CORRIENTE" y "SALDO A FAVOR" como medios de pago.
// Requiere extender tipos_pago.nombre de VARCHAR(15) a VARCHAR(20)
// porque "CUENTA CORRIENTE" tiene 16 caracteres.
// Parte de PR B — Libreta completa (2026-07-03).

exports.up = async function(knex) {
  // 1. Extender el campo nombre para acomodar los nuevos medios
  await knex.schema.alterTable('tipos_pago', table => {
    table.string('nombre', 20).alter();
  });

  // 2. Insertar idempotente — CUENTA CORRIENTE
  // icono "payments" = 8 chars, entra en VARCHAR(15)
  const existeCC = await knex('tipos_pago').where({ nombre: 'CUENTA CORRIENTE' }).first();
  if (!existeCC) {
    await knex('tipos_pago').insert({
      nombre: 'CUENTA CORRIENTE',
      icono: 'payments',
      color: '#6366f1',
      orden: 6
    });
  }

  // 3. Insertar idempotente — SALDO A FAVOR
  // icono "savings" = 7 chars, entra en VARCHAR(15)
  const existeSAF = await knex('tipos_pago').where({ nombre: 'SALDO A FAVOR' }).first();
  if (!existeSAF) {
    await knex('tipos_pago').insert({
      nombre: 'SALDO A FAVOR',
      icono: 'savings',
      color: '#10b981',
      orden: 7
    });
  }
};

exports.down = async function(knex) {
  await knex('tipos_pago').where({ nombre: 'CUENTA CORRIENTE' }).del();
  await knex('tipos_pago').where({ nombre: 'SALDO A FAVOR' }).del();
  // Revertir el tamaño de columna: si otras instalaciones no tienen datos largos,
  // esto es seguro. Si los tienen, el down fallará — comportamiento esperado.
  await knex.schema.alterTable('tipos_pago', table => {
    table.string('nombre', 15).alter();
  });
};
