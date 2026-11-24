// Regla nueva (2026-11-23, Nahu): PUT /pedidos/editar/:id rechaza el CAMBIO DE CLIENTE cuando la seña
// neta del pedido (calculada en el servidor) es > 0. El resto de la edición sigue permitida, con la regla
// existente total >= seña neta. Ver documentos/handoff_pedidos.md §2.8.
import { api, crearPedido, crearPedidoConSenia, pedidoPayload, Item } from '../helpers/api';
import { detallesDb, pagos, pedido, q } from '../helpers/db';
import { IDS, TP } from '../helpers/ids';

const ITEMS_1200: Item[] = [
  { idProducto: IDS.productoSimple, cantidad: 10, precio: 100 },
  { idProducto: IDS.productoMultiprecio, cantidad: 1, precio: 200 },
];

describe('Editar pedido: cambio de cliente y seña', () => {
  test('con seña > 0, cambiar el cliente da error y la base no cambia', async () => {
    const id = await crearPedidoConSenia(300);                 // cliente sin saldo
    const antes = await pedido(id);
    const detAntes = await detallesDb(id);

    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ idCliente: IDS.clienteConSaldo, items: ITEMS_1200 }));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/cliente/i);

    const despues = await pedido(id);
    expect(despues.idCliente).toBe(IDS.clienteSinSaldo);
    expect(despues.total).toBe(antes.total);
    expect(despues.fechaModificacion).toEqual(antes.fechaModificacion);
    expect(await detallesDb(id)).toEqual(detAntes);
  });

  test('con seña > 0, editar los ítems SIN cambiar el cliente funciona', async () => {
    const id = await crearPedidoConSenia(300);

    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ idCliente: IDS.clienteSinSaldo, items: ITEMS_1200 }));
    expect(res.status).toBe(200);

    const p = await pedido(id);
    expect(p).toMatchObject({ idCliente: IDS.clienteSinSaldo, total: '1200.00', idUsuarioModifico: IDS.usuarioAdmin });
    expect((await detallesDb(id)).map(d => d.idProducto)).toEqual([IDS.productoSimple, IDS.productoMultiprecio]);
  });

  test('con seña > 0, la regla existente sigue: total menor a la seña => 400', async () => {
    const id = await crearPedidoConSenia(300);
    const res = await api.put(`/pedidos/editar/${id}`,
      pedidoPayload({ idCliente: IDS.clienteSinSaldo, items: [{ idProducto: IDS.productoSimple, cantidad: 2, precio: 100 }] }));
    expect(res.status).toBe(400);
    expect((await pedido(id)).total).toBe('1000.00');
  });

  test('sin pagos (seña 0), cambiar el cliente funciona', async () => {
    const id = await crearPedido();
    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ idCliente: IDS.clienteConSaldo }));
    expect(res.status).toBe(200);
    expect((await pedido(id)).idCliente).toBe(IDS.clienteConSaldo);
  });

  test('con el pago anulado (seña neta 0), cambiar el cliente funciona', async () => {
    const id = await crearPedidoConSenia(300);
    const [pago] = await pagos(id);
    expect((await api.put(`/pedidos/pagos/anular/${pago.id}`)).status).toBe(200);

    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ idCliente: IDS.clienteConSaldo }));
    expect(res.status).toBe(200);
    expect((await pedido(id)).idCliente).toBe(IDS.clienteConSaldo);
  });

  // La API solo genera devoluciones al CANCELAR (y un pedido cancelado ya no se edita). Para probar el
  // cálculo "pago - devolución = 0" sobre un pedido activo, la devolución se inserta por SQL.
  test('con pago y devolución que se compensan (seña neta 0), cambiar el cliente funciona', async () => {
    // Actualizado 2026-11-24 (handoff_pedidos.md §2.10): una seña por transferencia ahora exige caja; antes iba con idCaja null.
    const id = await crearPedido({ senia: { monto: 300, idTipoPago: TP.TRANSFERENCIA, idCaja: IDS.cajaAbierta } });
    await q(`INSERT INTO pedidos_pagos (idPedido, idUsuario, tipo, idTipoPago, monto, idCaja)
             VALUES (?, ?, 'devolucion', ?, 300, NULL)`, [id, IDS.usuarioAdmin, TP.EFECTIVO]);

    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ idCliente: IDS.clienteConSaldo }));
    expect(res.status).toBe(200);
    expect((await pedido(id)).idCliente).toBe(IDS.clienteConSaldo);
  });
});
