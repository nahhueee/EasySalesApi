// Migration: ajusta las FK de cajas_movimientos.idEntrega / idVentaPagoDetalle a ON DELETE
// SET NULL.
//
// Motivo: al revertir un cobro de fiado ya NO se borra la fila de cajas_movimientos (decisión
// de Nahu, 2026-07-24 — un ingreso imputado a una caja no debe desaparecer del historial,
// se compensa con una SALIDA en vez de eliminarse). Pero la reversión SÍ sigue borrando la
// fila de origen (ventas_entrega o ventas_pagos_detalle, comportamiento preexistente que no
// se tocó). Con la FK en modo RESTRICT (default), ese borrado falla. Con SET NULL, el
// movimiento de caja se conserva íntegro (monto, tipo, descripción — que ya incluye el
// número de entrega/venta como texto) y solo pierde el vínculo estructurado al registro
// borrado.
//
// No usamos table.dropForeign(columna) sin nombre explícito: Knex adivina el nombre de la
// constraint con su convención por defecto, y ese nombre no siempre coincide con el que
// terminó creado en la base real (más aún si la migración 20260723120000 se aplicó en más de
// un intento). En cambio, buscamos el nombre real en information_schema antes de tocar nada.
// Esto además hace la migración idempotente: si se corre dos veces, o después de un fallo
// parcial, no rompe.
//
// Sigue a: 20260723120000_cobro_fiado_caja.js

// El primer intento (fallido) de 20260723120000 llegó a crear la columna
// cajas_movimientos.idVentaPagoDetalle como INT con signo antes de que fallara el ADD de la FK
// (son dos ALTER TABLE separados). El hasColumn() de esa migración la dio por buena en el
// reintento y nunca la corrigió a UNSIGNED (necesario para matchear ventas_pagos_detalle.id,
// que es INT UNSIGNED AUTO_INCREMENT). Verificamos el tipo real acá y lo corregimos si hace
// falta, antes de intentar crear la FK.
async function asegurarUnsigned(knex, tabla, columna) {
  const [col] = await knex('information_schema.COLUMNS')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', tabla)
    .andWhere('COLUMN_NAME', columna)
    .select('COLUMN_TYPE as tipo', 'IS_NULLABLE as esNullable');

  if (!col) return; // la columna no existe, no es este helper el que la crea

  const yaUnsigned = /unsigned/i.test(col.tipo);
  if (yaUnsigned) return;

  await knex.raw(`ALTER TABLE \`${tabla}\` MODIFY \`${columna}\` INT UNSIGNED NULL`);
}

async function obtenerForeignKeysDeColumna(knex, tabla, columna) {
  return knex('information_schema.KEY_COLUMN_USAGE as kcu')
    .join('information_schema.REFERENTIAL_CONSTRAINTS as rc', function () {
      this.on('rc.CONSTRAINT_NAME', '=', 'kcu.CONSTRAINT_NAME')
          .andOn('rc.CONSTRAINT_SCHEMA', '=', 'kcu.CONSTRAINT_SCHEMA');
    })
    .where('kcu.TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('kcu.TABLE_NAME', tabla)
    .andWhere('kcu.COLUMN_NAME', columna)
    .whereNotNull('kcu.REFERENCED_TABLE_NAME')
    .select('kcu.CONSTRAINT_NAME as nombre', 'rc.DELETE_RULE as reglaBorrado');
}

async function asegurarOnDeleteSetNull(knex, tabla, columna, tablaReferenciada) {
  const fks = await obtenerForeignKeysDeColumna(knex, tabla, columna);

  // Ya aplicado (re-ejecución después de un fallo parcial, o corrida repetida) — no hacer nada.
  if (fks.some(fk => fk.reglaBorrado === 'SET NULL')) return;

  for (const fk of fks) {
    await knex.raw(`ALTER TABLE \`${tabla}\` DROP FOREIGN KEY \`${fk.nombre}\``);
  }

  await knex.schema.alterTable(tabla, table => {
    table.foreign(columna).references(`${tablaReferenciada}.id`).onDelete('SET NULL');
  });
}

async function asegurarRestrict(knex, tabla, columna, tablaReferenciada) {
  const fks = await obtenerForeignKeysDeColumna(knex, tabla, columna);

  if (fks.some(fk => fk.reglaBorrado === 'RESTRICT' || fk.reglaBorrado === 'NO ACTION')) return;

  for (const fk of fks) {
    await knex.raw(`ALTER TABLE \`${tabla}\` DROP FOREIGN KEY \`${fk.nombre}\``);
  }

  await knex.schema.alterTable(tabla, table => {
    table.foreign(columna).references(`${tablaReferenciada}.id`);
  });
}

exports.up = async function (knex) {
  await asegurarOnDeleteSetNull(knex, 'cajas_movimientos', 'idEntrega', 'ventas_entrega');

  await asegurarUnsigned(knex, 'cajas_movimientos', 'idVentaPagoDetalle');
  await asegurarOnDeleteSetNull(knex, 'cajas_movimientos', 'idVentaPagoDetalle', 'ventas_pagos_detalle');
};

exports.down = async function (knex) {
  await asegurarRestrict(knex, 'cajas_movimientos', 'idVentaPagoDetalle', 'ventas_pagos_detalle');
  await asegurarRestrict(knex, 'cajas_movimientos', 'idEntrega', 'ventas_entrega');
};
