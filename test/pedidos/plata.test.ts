// Pedidos: caminos que mueven plata (seña, pagos a cuenta, anulación, cancelación, entrega, baja de venta).
// Cada test crea sus propios pedidos y verifica el estado de la base con SQL. Los montos de caja se
// verifican como DELTA (antes/después) porque la caja abierta del seed la comparten todos los tests.
import { api, crearPedido, crearPedidoConSenia, entregar } from '../helpers/api';
import {
  caja, contar, crearCaja, cerrarCaja, historial, insertar, movimientosDePedido, pagos, pedido, q, q1, saldoCC, senaNeta,
} from '../helpers/db';
import { IDS, TP } from '../helpers/ids';

const CAJA = IDS.cajaAbierta;

describe('Seña al crear el pedido', () => {
  test('seña en EFECTIVO: pago + ENTRADA en la caja (origen pedido) + historial null->pendiente', async () => {
    const antes = await caja(CAJA);
    const id = await crearPedidoConSenia(300);

    const [pago] = await pagos(id);
    expect(pago).toMatchObject({ tipo: 'pago', idTipoPago: TP.EFECTIVO, idCaja: CAJA, anulado: 0 });
    expect(Number(pago.monto)).toBe(300);

    const movs = await movimientosDePedido(id);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ tipoMovimiento: 'ENTRADA', origen: 'pedido', idCaja: CAJA, idPedidoPago: pago.id });
    expect(Number(movs[0].monto)).toBe(300);

    const despues = await caja(CAJA);
    expect(despues.entradas - antes.entradas).toBe(300);
    expect(despues.ventas).toBe(antes.ventas);

    expect(await historial(id)).toEqual([{ estadoAnterior: null, estadoNuevo: 'pendiente', observacion: null }]);
    expect(await pedido(id)).toMatchObject({ estado: 'pendiente', total: '1000.00' });
  });

  // Actualizado 2026-11-24 por cambio de regla (handoff_pedidos.md §2.10, CA-09): toda seña queda en la caja donde
  // se cobró, con cualquier medio. Antes se esperaba idCaja = NULL para los medios que no son efectivo.
  test('seña por TRANSFERENCIA: queda en la caja donde se cobró, SIN movimiento de caja', async () => {
    const antes = await caja(CAJA);
    const id = await crearPedido({ senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja: CAJA } });

    const [pago] = await pagos(id);
    expect(pago).toMatchObject({ tipo: 'pago', idTipoPago: TP.TRANSFERENCIA, idCaja: CAJA });
    expect(await movimientosDePedido(id)).toHaveLength(0);
    expect((await caja(CAJA)).entradas).toBe(antes.entradas);
    expect(await senaNeta(id)).toBe(200);
  });

  test.each([
    ['efectivo sin caja', 400, { monto: 300, idTipoPago: TP.EFECTIVO, idCaja: null }],
    ['efectivo en caja cerrada', 409, { monto: 300, idTipoPago: TP.EFECTIVO, idCaja: IDS.cajaCerrada }],
    // §2.10 (2026-11-24): cualquier medio exige caja, y abierta.
    ['transferencia sin caja', 400, { monto: 300, idTipoPago: TP.TRANSFERENCIA, idCaja: null }],
    ['transferencia en caja cerrada', 409, { monto: 300, idTipoPago: TP.TRANSFERENCIA, idCaja: IDS.cajaCerrada }],
    ['seña mayor al total', 400, { monto: 1500, idTipoPago: TP.EFECTIVO, idCaja: CAJA }],
    ['medio CUENTA CORRIENTE', 400, { monto: 300, idTipoPago: TP.CC, idCaja: CAJA }],
    ['medio SEÑA', 400, { monto: 300, idTipoPago: TP.SENIA, idCaja: CAJA }],
  ])('rechaza seña inicial: %s -> %i, y no se crea nada', async (_n, status, senia) => {
    const pedidosAntes = await contar('pedidos');
    const pagosAntes = await contar('pedidos_pagos');
    const movsAntes = await contar('cajas_movimientos');

    const res = await api.post('/pedidos/agregar', {
      idCliente: IDS.clienteSinSaldo, idCaja: CAJA, total: 1000,
      detalles: [{ idProducto: IDS.productoSimple, nomProd: 'P', cantidad: 10, precio: 100, costo: 0, total: 1000 }],
      senia,
    });
    expect(res.status).toBe(status);
    expect(await contar('pedidos')).toBe(pedidosAntes);
    expect(await contar('pedidos_pagos')).toBe(pagosAntes);
    expect(await contar('cajas_movimientos')).toBe(movsAntes);
  });
});

describe('Pago a cuenta posterior', () => {
  test('pago válido suma a la seña neta; uno que supera el saldo se rechaza sin cambios', async () => {
    const id = await crearPedidoConSenia(300);

    const ok = await api.post(`/pedidos/pagos/${id}`, { monto: 500, idTipoPago: TP.TRANSFERENCIA, idCaja: CAJA });
    expect(ok.status).toBe(200);
    expect(await senaNeta(id)).toBe(800);

    const excede = await api.post(`/pedidos/pagos/${id}`, { monto: 201, idTipoPago: TP.EFECTIVO, idCaja: CAJA });
    expect(excede.status).toBe(400);
    expect(await senaNeta(id)).toBe(800);
    expect(await pagos(id)).toHaveLength(2);
  });
});

describe('Anular pago a cuenta', () => {
  test('con la caja abierta: marca anulado y compensa con una SALIDA (no borra nada)', async () => {
    const antes = await caja(CAJA);
    const id = await crearPedidoConSenia(300);
    const [pago] = await pagos(id);

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(200);

    const [pagoDespues] = await pagos(id);
    expect(pagoDespues.anulado).toBe(1);
    expect(pagoDespues.fechaAnulacion).not.toBeNull();
    expect(await senaNeta(id)).toBe(0);

    const movs = await movimientosDePedido(id);
    expect(movs.map(m => m.tipoMovimiento)).toEqual(['ENTRADA', 'SALIDA']);
    expect(Number(movs[1].monto)).toBe(300);
    expect(movs[0].idMovimientoCompensado).toBe(movs[1].id);

    const despues = await caja(CAJA);
    expect(despues.entradas - antes.entradas).toBe(300);
    expect(despues.salidas - antes.salidas).toBe(300);
  });

  test('con la caja de origen cerrada: 409 y nada cambia', async () => {
    const cajaTemp = await crearCaja(false);
    const id = await crearPedidoConSenia(300, { idCaja: cajaTemp });
    const [pago] = await pagos(id);
    await cerrarCaja(cajaTemp);

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cerrada/i);
    expect((await pagos(id))[0].anulado).toBe(0);
    expect(await movimientosDePedido(id)).toHaveLength(1);
  });

  // CA-13.B (§2.10, 2026-11-24): la anulación decide por el MEDIO y por el MOVIMIENTO.
  test('efectivo sin su ENTRADA (dato inconsistente): 409 y nada cambia, nunca sigue en silencio', async () => {
    const id = await crearPedidoConSenia(300);
    const [pago] = await pagos(id);
    await q('DELETE FROM cajas_movimientos WHERE idPedidoPago = ?', [pago.id]);   // simula la inconsistencia
    const movsAntes = await contar('cajas_movimientos');

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('No se encontró el movimiento de caja del pago.');
    expect((await pagos(id))[0].anulado).toBe(0);
    expect(await contar('cajas_movimientos')).toBe(movsAntes);
  });

  test('otro medio: anula sin buscar ni compensar movimientos de caja', async () => {
    const idCaja = await crearCaja(false);
    const id = await crearPedido({ idCaja, senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja } });
    const [pago] = await pagos(id);
    // ENTRADA falsa con el idPedidoPago de este pago: si la anulación buscara movimiento, la compensaría.
    const idFalsa = await insertar(
      `INSERT INTO cajas_movimientos (idCaja, tipoMovimiento, monto, descripcion, idPedidoPago, origen)
       VALUES (?, 'ENTRADA', 200, 'falsa (test)', ?, 'pedido')`, [idCaja, pago.id]);
    const cajaAntes = await caja(idCaja);

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(200);
    expect((await pagos(id))[0].anulado).toBe(1);
    expect((await q1<any>('SELECT idMovimientoCompensado FROM cajas_movimientos WHERE id = ?', [idFalsa])).idMovimientoCompensado).toBeNull();
    expect(await contar('cajas_movimientos', "idCaja = ? AND tipoMovimiento = 'SALIDA'", [idCaja])).toBe(0);
    expect(await caja(idCaja)).toEqual(cajaAntes);
  });

  test('otro medio con la caja donde se cobró cerrada: 409 y nada cambia', async () => {
    const idCaja = await crearCaja(false);
    const id = await crearPedido({ idCaja, senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja } });
    const [pago] = await pagos(id);
    await cerrarCaja(idCaja);

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cerrada/i);
    expect((await pagos(id))[0].anulado).toBe(0);
  });

  test('un pago ya anulado no se anula dos veces (409)', async () => {
    const id = await crearPedidoConSenia(300);
    const [pago] = await pagos(id);
    expect((await api.put(`/pedidos/pagos/anular/${pago.id}`)).status).toBe(200);

    const res = await api.put(`/pedidos/pagos/anular/${pago.id}`);
    expect(res.status).toBe(409);
    expect(await movimientosDePedido(id)).toHaveLength(2);
  });

  test('el movimiento de seña NO se puede anular ni eliminar desde el ABM de movimientos', async () => {
    const id = await crearPedidoConSenia(300);
    const [mov] = await movimientosDePedido(id);

    // Contrato histórico del ABM manual: 200 con el texto del motivo (no un error HTTP).
    const anular = await api.put('/movimientos/anular', { id: mov.id });
    expect(anular.status).toBe(200);
    expect(JSON.stringify(anular.body)).toMatch(/seña de pedido/i);
    const eliminar = await api.put('/movimientos/eliminar', { id: mov.id, idCaja: CAJA, monto: 300, tipoMovimiento: 'ENTRADA' });
    expect(eliminar.status).toBe(200);
    expect(JSON.stringify(eliminar.body)).toMatch(/seña de pedido/i);

    const movs = await movimientosDePedido(id);
    expect(movs).toHaveLength(1);
    expect(movs[0].idMovimientoCompensado).toBeNull();
    expect((await pagos(id))[0].anulado).toBe(0);
  });
});

describe('Cancelar pedido', () => {
  test('con seña y sin elegir destino: 400 y el pedido sigue activo', async () => {
    const id = await crearPedidoConSenia(300);
    const res = await api.put(`/pedidos/cancelar/${id}`, { motivo: 'test' });
    expect(res.status).toBe(400);
    expect((await pedido(id)).estado).toBe('pendiente');
  });

  test('devolviendo la seña: pago tipo devolucion en EFECTIVO + SALIDA en la caja actual', async () => {
    const id = await crearPedidoConSenia(300);
    const antes = await caja(CAJA);

    const res = await api.put(`/pedidos/cancelar/${id}`, { motivo: 'no lo quiere', destinoSenia: 'devuelta', idCaja: CAJA });
    expect(res.status).toBe(200);

    const p = await pedido(id);
    expect(p).toMatchObject({ estado: 'cancelado', destinoSenia: 'devuelta', motivoCancelacion: 'no lo quiere', idUsuarioCancelo: IDS.usuarioAdmin });
    const ps = await pagos(id);
    expect(ps[1]).toMatchObject({ tipo: 'devolucion', idTipoPago: TP.EFECTIVO, idCaja: CAJA });
    expect(Number(ps[1].monto)).toBe(300);
    expect(await senaNeta(id)).toBe(0);

    const movs = await movimientosDePedido(id);
    expect(movs.map(m => m.tipoMovimiento)).toEqual(['ENTRADA', 'SALIDA']);
    expect((await caja(CAJA)).salidas - antes.salidas).toBe(300);

    const h = await historial(id);
    expect(h[h.length - 1]).toMatchObject({ estadoAnterior: 'pendiente', estadoNuevo: 'cancelado' });
    expect(h[h.length - 1].observacion).toMatch(/devuelta/);
  });

  test('reteniendo la seña: sin movimientos nuevos, destinoSenia=retenida', async () => {
    const id = await crearPedidoConSenia(300);
    const antes = await caja(CAJA);

    const res = await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'retenida' });
    expect(res.status).toBe(200);
    expect(await pedido(id)).toMatchObject({ estado: 'cancelado', destinoSenia: 'retenida' });
    expect(await pagos(id)).toHaveLength(1);
    expect(await movimientosDePedido(id)).toHaveLength(1);
    expect(await caja(CAJA)).toEqual(antes);
    expect(await senaNeta(id)).toBe(300);
  });

  test('devolver sin caja: 400 y nada cambia', async () => {
    const id = await crearPedidoConSenia(300);
    const res = await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'devuelta' });
    expect(res.status).toBe(400);
    expect((await pedido(id)).estado).toBe('pendiente');
    expect(await pagos(id)).toHaveLength(1);
  });

  // #6 (corregido 2026-11-23): sin seña, destinoSenia se ignora y la caja no se mira.
  test('#6: cancelar SIN seña con destino devuelta y caja cerrada cancela igual (sin tocar la caja)', async () => {
    const id = await crearPedido();
    const cajaAntes = await caja(IDS.cajaCerrada);
    const res = await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'devuelta', idCaja: IDS.cajaCerrada });
    expect(res.status).toBe(200);
    expect(await pedido(id)).toMatchObject({ estado: 'cancelado', destinoSenia: null });
    expect(await pagos(id)).toHaveLength(0);
    expect(await caja(IDS.cajaCerrada)).toEqual(cajaAntes);
  });

  test('#6 control: CON seña, devolver desde una caja cerrada sigue dando 409 y nada cambia', async () => {
    const id = await crearPedidoConSenia(300);
    const res = await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'devuelta', idCaja: IDS.cajaCerrada });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/caja #\d+ está cerrada/);
    expect((await pedido(id)).estado).toBe('pendiente');
    expect(await pagos(id)).toHaveLength(1);
  });
});

describe('Entrega (venta desde el pedido)', () => {
  test('con seña exacta: venta creada, pedido entregado, la seña no se cuenta dos veces en caja y libreta en 0', async () => {
    const id = await crearPedidoConSenia(300);              // cliente sin saldo
    const antes = await caja(CAJA);
    const saldoAntes = await saldoCC(IDS.clienteSinSaldo);

    const res = await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }] });
    expect(res.status).toBe(200);
    const idVenta = Number(res.body);

    expect(await pedido(id)).toMatchObject({ estado: 'entregado', idVentaGenerada: idVenta });
    const h = await historial(id);
    expect(h[h.length - 1]).toMatchObject({ estadoAnterior: 'pendiente', estadoNuevo: 'entregado' });

    const vpd = await q('SELECT idTPago, monto FROM ventas_pagos_detalle WHERE idVenta = ? ORDER BY idTPago', [idVenta]);
    expect(vpd.map(r => [r.idTPago, Number(r.monto)])).toEqual([[TP.EFECTIVO, 700], [TP.SENIA, 300]]);

    const despues = await caja(CAJA);
    expect(despues.ventas - antes.ventas).toBe(1000);
    expect(despues.entradas).toBe(antes.entradas);           // la seña entró una sola vez, al cobrarla

    // Libreta (cliente != CF): debe 1000, haber 300 (SEÑA), haber 700 (EFECTIVO) => sin cambio neto.
    const ledger = await q('SELECT tipo, debe, haber FROM cuenta_corriente_movimientos WHERE idCliente = ? AND idReferencia = ? ORDER BY id',
      [IDS.clienteSinSaldo, idVenta]);
    expect(ledger.map(l => [l.tipo, Number(l.debe), Number(l.haber)])).toEqual([['venta', 1000, 0], ['entrega', 0, 300], ['entrega', 0, 700]]);
    expect(await saldoCC(IDS.clienteSinSaldo)).toBe(saldoAntes);
  });

  test('seña en caja 1, entrega en caja 2: la caja 2 cobra solo el resto en efectivo y la caja 1 no cambia', async () => {
    const caja1 = await crearCaja(false);
    const caja2 = await crearCaja(false);
    const id = await crearPedidoConSenia(300, { idCaja: caja1 });
    const c1Antes = await caja(caja1);

    const res = await entregar({ idPedido: id, idCaja: caja2, pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }] });
    expect(res.status).toBe(200);

    expect(await caja(caja1)).toEqual(c1Antes);                         // la seña ya estaba (ENTRADA 300)
    expect(c1Antes.entradas).toBe(300);
    const c2 = await caja(caja2);
    expect(c2).toMatchObject({ entradas: 0, salidas: 0, ventas: 1000 });
    // Efectivo de ventas de la caja 2 (lo que suma al efectivo esperado del arqueo) = solo el resto.
    const efe: any = await q1(
      `SELECT COALESCE(SUM(vpd.monto),0) AS efectivo FROM ventas_pagos_detalle vpd JOIN ventas v ON v.id = vpd.idVenta
       WHERE v.idCaja = ? AND vpd.idTPago = ? AND v.fechaBaja IS NULL`, [caja2, TP.EFECTIVO]);
    expect(Number(efe.efectivo)).toBe(700);
  });

  test('resto a CUENTA CORRIENTE: la deuda aumenta total - seña', async () => {
    const id = await crearPedidoConSenia(300, { idCliente: IDS.clienteConSaldo });
    const saldoAntes = await saldoCC(IDS.clienteConSaldo);

    const res = await entregar({ idPedido: id, idCliente: IDS.clienteConSaldo,
      pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.CC, monto: 0 }], realizado: false });
    expect(res.status).toBe(200);
    expect(await saldoCC(IDS.clienteConSaldo)).toBe(saldoAntes + 700);
  });

  test.each([
    ['monto SEÑA distinto a la seña neta', 409, IDS.clienteSinSaldo, [{ idTipoPago: TP.SENIA, monto: 200 }, { idTipoPago: TP.EFECTIVO, monto: 800 }]],
    ['sin detalle SEÑA habiendo seña', 409, IDS.clienteSinSaldo, [{ idTipoPago: TP.EFECTIVO, monto: 1000 }]],
    ['a otro cliente distinto del pedido', 400, IDS.clienteConSaldo, [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }]],
  ])('rechaza la entrega: %s -> %i; no se crea venta y el pedido sigue activo', async (_n, status, idCliente, pagosVenta) => {
    const id = await crearPedidoConSenia(300);
    const ventasAntes = await contar('ventas');
    const antes = await caja(CAJA);

    const res = await entregar({ idPedido: id, idCliente, pagos: pagosVenta });
    expect(res.status).toBe(status);
    expect(await contar('ventas')).toBe(ventasAntes);
    expect(await pedido(id)).toMatchObject({ estado: 'pendiente', idVentaGenerada: null });
    expect(await caja(CAJA)).toEqual(antes);
  });

  test('una venta SIN pedido no puede usar el medio SEÑA (400)', async () => {
    const ventasAntes = await contar('ventas');
    const res = await entregar({ pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }] });
    expect(res.status).toBe(400);
    expect(await contar('ventas')).toBe(ventasAntes);
  });

  test('no se puede entregar un pedido cancelado (409)', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(200);
    const res = await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] });
    expect(res.status).toBe(409);
    expect((await pedido(id)).idVentaGenerada).toBeNull();
  });

  test('doble entrega concurrente: una pasa y la otra falla con 409; una sola venta', async () => {
    const id = await crearPedidoConSenia(300);
    const ventasAntes = await contar('ventas');
    const pagosVenta = [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }];

    const [a, b] = await Promise.all([entregar({ idPedido: id, pagos: pagosVenta }), entregar({ idPedido: id, pagos: pagosVenta })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await contar('ventas')).toBe(ventasAntes + 1);
    expect((await historial(id)).filter(h => h.estadoNuevo === 'entregado')).toHaveLength(1);
  });
});

describe('Baja de la venta de entrega', () => {
  test('el pedido vuelve a listo, la seña se conserva, la libreta y la caja se revierten; se puede volver a entregar', async () => {
    const id = await crearPedidoConSenia(300);
    const cajaAntes = await caja(CAJA);
    const saldoAntes = await saldoCC(IDS.clienteSinSaldo);
    const pagosVenta = [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }];

    const venta = await entregar({ idPedido: id, pagos: pagosVenta });
    expect(venta.status).toBe(200);
    const idVenta = Number(venta.body);

    const baja = await api.put('/ventas/eliminar', { venta: { id: idVenta }, observacion: 'test baja' });
    expect(baja.status).toBe(200);

    expect(await pedido(id)).toMatchObject({ estado: 'listo', idVentaGenerada: null });
    const h = await historial(id);
    expect(h[h.length - 1]).toMatchObject({ estadoAnterior: 'entregado', estadoNuevo: 'listo', observacion: `Venta #${idVenta} dada de baja` });
    expect(await senaNeta(id)).toBe(300);
    expect((await q1('SELECT fechaBaja FROM ventas WHERE id = ?', [idVenta])).fechaBaja).not.toBeNull();
    expect((await caja(CAJA)).ventas).toBe(cajaAntes.ventas);
    expect(await saldoCC(IDS.clienteSinSaldo)).toBe(saldoAntes);

    const otraVez = await entregar({ idPedido: id, pagos: pagosVenta });
    expect(otraVez.status).toBe(200);
    expect(await pedido(id)).toMatchObject({ estado: 'entregado', idVentaGenerada: Number(otraVez.body) });
  });
});
