exports.up = async function(knex) {
  // =========================
  // 0. Fix PK ventas (CRÍTICO)
  // =========================
  const pkInfo = await knex.raw(`
    SHOW KEYS FROM ventas WHERE Key_name = 'PRIMARY'
  `);

  const primaryKeys = pkInfo[0].map(r => r.Column_name);

  // Si la PK es compuesta (tiene idCaja)
  if (primaryKeys.includes('idCaja')) {

    console.log('⚠️ Corrigiendo PK compuesta en ventas...');

    // ⚠️ IMPORTANTE: esto falla si hay duplicados
    await knex.raw(`
      ALTER TABLE ventas
      DROP PRIMARY KEY,
      MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      ADD PRIMARY KEY (id)
    `);
  }

  // =========================
  // 1. Crear tabla si no existe
  // =========================
  const exists = await knex.schema.hasTable('ventas_pagos_detalle');

  if (!exists) {
    await knex.schema.createTable('ventas_pagos_detalle', table => {
      table.increments('id').primary();
      table.integer('idVenta').notNullable();
      table.integer('idTPago').notNullable();
      table.decimal('monto', 10, 2).notNullable();
      table.dateTime('fecha').defaultTo(knex.fn.now());

      table.foreign('idVenta').references('ventas.id');
    });
  }

  // =========================
  // 2. Alter ventas_pago
  // =========================

  // monto
  const hasMonto = await knex.schema.hasColumn('ventas_pago', 'monto');
  if (!hasMonto) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.decimal('monto', 10, 2).defaultTo(0);
    });
  }

  // tipoModificador
  const hasTipoModificador = await knex.schema.hasColumn('ventas_pago', 'tipoModificador');
  if (!hasTipoModificador) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.enu('tipoModificador', ['porcentaje', 'monto']).nullable();
    });
  }

  // =========================
  // 3. MODIFY columnas (raw → knex no maneja bien modify)
  // =========================
  await knex.raw(`
    ALTER TABLE ventas_pago
    MODIFY idPago INT DEFAULT 0,
    MODIFY efectivo DECIMAL(10,2) DEFAULT 0,
    MODIFY digital DECIMAL(10,2) DEFAULT 0,
    MODIFY recargo DECIMAL(10,2) DEFAULT 0,
    MODIFY descuento DECIMAL(10,2) DEFAULT 0
  `);

  // =========================
  // 4. Alter ventas
  // =========================

  const hasFechaBaja = await knex.schema.hasColumn('ventas', 'fechaBaja');
  if (!hasFechaBaja) {
    await knex.schema.alterTable('ventas', table => {
      table.date('fechaBaja').nullable();
    });
  }

  const hasObsBaja = await knex.schema.hasColumn('ventas', 'obsBaja');
  if (!hasObsBaja) {
    await knex.schema.alterTable('ventas', table => {
      table.string('obsBaja', 200).defaultTo('');
    });
  }

  // =========================
  // 5. Migración de datos (idempotente real)
  // =========================

  // efectivo
  await knex.raw(`
    INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto)
    SELECT vp.idVenta, vp.idPago, vp.efectivo
    FROM ventas_pago vp
    WHERE vp.efectivo > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ventas_pagos_detalle vpd
        WHERE vpd.idVenta = vp.idVenta
          AND vpd.idTPago = vp.idPago
          AND vpd.monto = vp.efectivo
      )
  `);

  // digital
  await knex.raw(`
    INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto)
    SELECT vp.idVenta, vp.idPago, vp.digital
    FROM ventas_pago vp
    WHERE vp.digital > 0
      AND NOT EXISTS (
        SELECT 1
        FROM ventas_pagos_detalle vpd
        WHERE vpd.idVenta = vp.idVenta
          AND vpd.idTPago = vp.idPago
          AND vpd.monto = vp.digital
      )
  `);
};

exports.down = async function(knex) {
  // =========================
  // Rollback (cuidadoso)
  // =========================

  // eliminar datos migrados (opcional)
  await knex('ventas_pagos_detalle').del();

  // drop tabla si existe
  const exists = await knex.schema.hasTable('ventas_pagos_detalle');
  if (exists) {
    await knex.schema.dropTable('ventas_pagos_detalle');
  }

  // eliminar columnas agregadas

  const hasMonto = await knex.schema.hasColumn('ventas_pago', 'monto');
  if (hasMonto) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.dropColumn('monto');
    });
  }

  const hasTipoModificador = await knex.schema.hasColumn('ventas_pago', 'tipoModificador');
  if (hasTipoModificador) {
    await knex.schema.alterTable('ventas_pago', table => {
      table.dropColumn('tipoModificador');
    });
  }

  const hasFechaBaja = await knex.schema.hasColumn('ventas', 'fechaBaja');
  if (hasFechaBaja) {
    await knex.schema.alterTable('ventas', table => {
      table.dropColumn('fechaBaja');
    });
  }

  const hasObsBaja = await knex.schema.hasColumn('ventas', 'obsBaja');
  if (hasObsBaja) {
    await knex.schema.alterTable('ventas', table => {
      table.dropColumn('obsBaja');
    });
  }
};