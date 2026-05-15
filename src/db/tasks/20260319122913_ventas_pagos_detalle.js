exports.up = async function(knex) {

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
  // 3. MODIFY columnas solo si existen
  // =========================

  const columnasModificar = [
    {
      nombre: 'idPago',
      sql: 'MODIFY idPago INT DEFAULT 0'
    },
    {
      nombre: 'efectivo',
      sql: 'MODIFY efectivo DECIMAL(10,2) DEFAULT 0'
    },
    {
      nombre: 'digital',
      sql: 'MODIFY digital DECIMAL(10,2) DEFAULT 0'
    },
    {
      nombre: 'recargo',
      sql: 'MODIFY recargo DECIMAL(10,2) DEFAULT 0'
    },
    {
      nombre: 'descuento',
      sql: 'MODIFY descuento DECIMAL(10,2) DEFAULT 0'
    }
  ];

  for (const col of columnasModificar) {
    const existe = await knex.schema.hasColumn('ventas_pago', col.nombre);

    if (existe) {
      await knex.raw(`
        ALTER TABLE ventas_pago
        ${col.sql}
      `);
    }
  }

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
  const hasEfectivo = await knex.schema.hasColumn('ventas_pago', 'efectivo');
  const hasDigital = await knex.schema.hasColumn('ventas_pago', 'digital');
  const hasIdPago = await knex.schema.hasColumn('ventas_pago', 'idPago');

  if (hasEfectivo && hasIdPago) {
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
  }

  if (hasDigital && hasIdPago) {
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
  }
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