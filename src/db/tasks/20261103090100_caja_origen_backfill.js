/**
 * Migration (DATOS): Fase 3.4-A — backfill de `origen` en ventas_pagos_detalle y cajas_movimientos.
 * Ver documentos/handoff_fase3_4a_caja_backend.md §3.2 y 8-bis (A2). Va separada del DDL (§13.3).
 *
 * IMPORTANTE — esta regla es solo para el HISTÓRICO. Depender de un texto (`descripcion`) es frágil.
 * Desde esta fase todo INSERT nuevo pone `origen` explícito (ventasRepository.InsertPagoVentaDetalle,
 * cuentasCorsRepository.EntregaDinero, MovimientosRepo.Agregar) y estas reglas no se vuelven a usar.
 *
 * ventas_pagos_detalle (informe 3.4-0, confirmado): cobro = R1 ∪ R2 ∪ R3. Todo lo demás es 'venta'.
 * No hay heurística de tiempo: en los 3 backups toda fila con más de 10 min de diferencia ya cae en
 * R1/R2/R3, y una regla por tiempo perdería los cobros hechos a los pocos minutos de la venta.
 *   R1: idEntrega IS NOT NULL                       (cobro parcial, EntregaDinero)
 *   R2: idCaja IS NOT NULL                          (pago completo imputado a caja)
 *   R3: ledger del cliente tiene tipo='ajuste', descripcion='Pago manual de venta',
 *       idReferencia = idVenta y haber = monto, Y la fila es la ÚLTIMA (id máximo) de la venta
 *       (pago completo sin caja, ActualizarEstadoPago — ya eliminado, pero dejó filas históricas).
 *
 * cajas_movimientos (A2):
 *   cobro      si idEntrega o idVentaPagoDetalle no son NULL, o la descripción empieza con
 *              'Cobro fiado' o 'Reversión de cobro fiado' (textos fijos de cuentasCorsRepository;
 *              cubre también las variantes "(pago completo)" de ActualizarEstadoPago).
 *   proveedor  si idProveedorMovimiento no es NULL.
 *   manual     cualquier otro caso.
 *   La compensación de Anular hereda el origen del movimiento que compensa (el original apunta a
 *   su compensación con idMovimientoCompensado).
 *
 * Idempotente: solo toca filas con origen IS NULL. Un UPDATE (… JOIN) por regla, no un loop por fila.
 * Los conteos por regla quedan en el log de la migration, para el PR.
 */

async function ejecutar(knex, etiqueta, sql) {
  const [res] = await knex.raw(sql);
  const n = res && typeof res.affectedRows === 'number' ? res.affectedRows : 0;
  console.log(`[caja_origen_backfill] ${etiqueta}: ${n}`);
  return n;
}

exports.up = async function (knex) {
  const tieneVpd = await knex.schema.hasColumn('ventas_pagos_detalle', 'origen');
  const tieneMov = await knex.schema.hasColumn('cajas_movimientos', 'origen');
  if (!tieneVpd || !tieneMov) {
    throw new Error('Falta ejecutar 20261103090000_caja_cierres_y_origen_pagos antes del backfill.');
  }

  //#region ventas_pagos_detalle
  await ejecutar(knex, 'vpd R1 (idEntrega) -> cobro',
    `UPDATE ventas_pagos_detalle SET origen = 'cobro'
      WHERE origen IS NULL AND idEntrega IS NOT NULL`);

  await ejecutar(knex, 'vpd R2 (idCaja) -> cobro',
    `UPDATE ventas_pagos_detalle SET origen = 'cobro'
      WHERE origen IS NULL AND idCaja IS NOT NULL`);

  if (await knex.schema.hasTable('cuenta_corriente_movimientos')) {
    await ejecutar(knex, 'vpd R3 (ledger pago manual + ultima fila) -> cobro',
      `UPDATE ventas_pagos_detalle vpd
         JOIN (SELECT DISTINCT idReferencia, haber
                 FROM cuenta_corriente_movimientos
                WHERE tipo = 'ajuste' AND descripcion = 'Pago manual de venta') l3
           ON l3.idReferencia = vpd.idVenta AND l3.haber = vpd.monto
         JOIN (SELECT idVenta, MAX(id) AS maxId
                 FROM ventas_pagos_detalle GROUP BY idVenta) lm
           ON lm.idVenta = vpd.idVenta AND lm.maxId = vpd.id
          SET vpd.origen = 'cobro'
        WHERE vpd.origen IS NULL`);
  }

  await ejecutar(knex, 'vpd resto -> venta',
    `UPDATE ventas_pagos_detalle SET origen = 'venta' WHERE origen IS NULL`);
  //#endregion

  //#region cajas_movimientos
  await ejecutar(knex, 'mov cobro (referencias o descripcion)',
    `UPDATE cajas_movimientos SET origen = 'cobro'
      WHERE origen IS NULL
        AND (idEntrega IS NOT NULL OR idVentaPagoDetalle IS NOT NULL
             OR descripcion LIKE 'Cobro fiado%' OR descripcion LIKE 'Reversión de cobro fiado%')`);

  await ejecutar(knex, 'mov proveedor (idProveedorMovimiento)',
    `UPDATE cajas_movimientos SET origen = 'proveedor'
      WHERE origen IS NULL AND idProveedorMovimiento IS NOT NULL`);

  await ejecutar(knex, 'mov compensaciones heredan origen del original',
    `UPDATE cajas_movimientos comp
       JOIN cajas_movimientos orig ON orig.idMovimientoCompensado = comp.id
        SET comp.origen = orig.origen
      WHERE comp.origen IS NULL AND orig.origen IS NOT NULL`);

  await ejecutar(knex, 'mov resto -> manual',
    `UPDATE cajas_movimientos SET origen = 'manual' WHERE origen IS NULL`);
  //#endregion
};

exports.down = async function (knex) {
  // El backfill es solo de datos: volver atrás deja el origen en NULL (lo borra el down del DDL).
  if (await knex.schema.hasColumn('ventas_pagos_detalle', 'origen')) {
    await knex.raw('UPDATE ventas_pagos_detalle SET origen = NULL');
  }
  if (await knex.schema.hasColumn('cajas_movimientos', 'origen')) {
    await knex.raw('UPDATE cajas_movimientos SET origen = NULL');
  }
};
