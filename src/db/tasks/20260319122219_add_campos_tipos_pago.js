exports.up = async function(knex) {
  // 1. Agregar columnas si no existen
  const hasIcono = await knex.schema.hasColumn('tipos_pago', 'icono');
  if (!hasIcono) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.string('icono', 15);
    });
  }

  const hasColor = await knex.schema.hasColumn('tipos_pago', 'color');
  if (!hasColor) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.string('color', 15);
    });
  }

  const hasOrden = await knex.schema.hasColumn('tipos_pago', 'orden');
  if (!hasOrden) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.integer('orden');
    });
  }

  // 2. Updates (idempotentes por naturaleza)
  await knex('tipos_pago')
    .update({ icono: 'monetization_on', color: '#2dc051', orden: 1 })
    .where({ nombre: 'EFECTIVO' });

  await knex('tipos_pago')
    .update({ icono: 'account_balance', color: '#2db6c8', orden: 2 })
    .where({ nombre: 'TRANSFERENCIA' });

  await knex('tipos_pago')
    .update({ icono: 'credit_card', color: '#ee8b29', orden: 4 })
    .where({ nombre: 'TARJETA' });

  await knex('tipos_pago')
    .update({ icono: 'autorenew', color: '#7d7d7d', orden: 5 })
    .where({ nombre: 'COMBINADO' });

  // 3. Insert idempotente (QR)
  const existeQR = await knex('tipos_pago')
    .where({ nombre: 'QR' })
    .first();

  if (!existeQR) {
    await knex('tipos_pago').insert({
      nombre: 'QR',
      icono: 'qr_code',
      color: '#fc7b9b',
      orden: 3
    });
  }
};

exports.down = async function(knex) {
  // Opcional: rollback limpio

  // Eliminar QR si existe
  await knex('tipos_pago')
    .where({ nombre: 'QR' })
    .del();

  // Eliminar columnas SOLO si existen
  const hasIcono = await knex.schema.hasColumn('tipos_pago', 'icono');
  if (hasIcono) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.dropColumn('icono');
    });
  }

  const hasColor = await knex.schema.hasColumn('tipos_pago', 'color');
  if (hasColor) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.dropColumn('color');
    });
  }

  const hasOrden = await knex.schema.hasColumn('tipos_pago', 'orden');
  if (hasOrden) {
    await knex.schema.alterTable('tipos_pago', table => {
      table.dropColumn('orden');
    });
  }
};