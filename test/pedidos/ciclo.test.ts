// Pedidos: alta, consulta, edición, transiciones de estado, cancelación sin seña, validaciones y referencias.
// (Los caminos con plata están en plata.test.ts; la regla de cliente+seña en editar-cliente.test.ts.)
import { api, crearPedido, crearPedidoConSenia, entregar, pedidoPayload, ventaPayload, Item } from '../helpers/api';
import { caja, contar, detallesDb, historial, insertar, pedido, q, q1, saldoCC } from '../helpers/db';
import { CONSUMIDOR_FINAL, IDS, TP } from '../helpers/ids';

const CAJA = IDS.cajaAbierta;
const stock = async (idProducto: number) => Number((await q1('SELECT cantidad FROM productos WHERE id = ?', [idProducto])).cantidad);

describe('Alta de pedido', () => {
  test('consumidor final con contacto: se guarda el contacto, estado pendiente, usuario del header', async () => {
    const id = await crearPedido({ idCliente: CONSUMIDOR_FINAL, contactoNombre: 'Juan Perez', contactoTelefono: '1144443333', observaciones: 'Para el viernes' });
    expect(await pedido(id)).toMatchObject({
      idCliente: CONSUMIDOR_FINAL, contactoNombre: 'Juan Perez', contactoTelefono: '1144443333',
      observaciones: 'Para el viernes', estado: 'pendiente', total: '1000.00', idCaja: CAJA, idUsuario: IDS.usuarioAdmin,
      idVentaGenerada: null, destinoSenia: null,
    });
    expect(await historial(id)).toEqual([{ estadoAnterior: null, estadoNuevo: 'pendiente', observacion: null }]);
    expect(await contar('eventos', "accion = 'PEDIDO_CREAR' AND entidadId = ?", [id])).toBe(1);
  });

  test('cliente registrado: el contacto libre se ignora (null)', async () => {
    const id = await crearPedido({ idCliente: IDS.clienteConSaldo, contactoNombre: 'Otro', contactoTelefono: '999' });
    expect(await pedido(id)).toMatchObject({ idCliente: IDS.clienteConSaldo, contactoNombre: null, contactoTelefono: null });
  });

  test('multiprecio: guarda el precio pactado como snapshot (Mayorista 150), no el de la lista Minorista', async () => {
    const items: Item[] = [{ idProducto: IDS.productoMultiprecio, cantidad: 2, precio: 150, costo: 90 }];
    const id = await crearPedido({ items });
    const [d] = await detallesDb(id);
    expect(d).toMatchObject({ idProducto: IDS.productoMultiprecio, cantidad: '2.000', precio: '150.00', total: '300.00' });
    expect((await pedido(id)).total).toBe('300.00');
  });

  test('crear un pedido NO toca stock, caja ni cuenta corriente', async () => {
    const stockAntes = await stock(IDS.productoSimple);
    const cajaAntes = await caja(CAJA);
    const saldoAntes = await saldoCC(IDS.clienteConSaldo);
    await crearPedido({ idCliente: IDS.clienteConSaldo });
    expect(await stock(IDS.productoSimple)).toBe(stockAntes);
    expect(await caja(CAJA)).toEqual(cajaAntes);
    expect(await saldoCC(IDS.clienteConSaldo)).toBe(saldoAntes);
  });

  test('el stock se mueve recién al entregar (vía venta)', async () => {
    const id = await crearPedido();
    const stockAntes = await stock(IDS.productoSimple);
    expect((await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] })).status).toBe(200);
    expect(await stock(IDS.productoSimple)).toBe(stockAntes - 10);
  });

  const base = () => pedidoPayload();
  test.each([
    ['sin cliente', () => ({ ...base(), idCliente: 0 })],
    ['sin productos', () => ({ ...base(), detalles: [], total: 0 })],
    ['cantidad 0', () => ({ ...base(), detalles: [{ ...base().detalles[0], cantidad: 0 }] })],
    ['total 0', () => ({ ...base(), detalles: [{ ...base().detalles[0], precio: 0, total: 0 }], total: 0 })],
    ['total que no coincide con los ítems', () => ({ ...base(), total: 999 })],
    ['observaciones de más de 500 caracteres', () => ({ ...base(), observaciones: 'x'.repeat(501) })],
    ['fecha de entrega inválida', () => ({ ...base(), fechaEntregaEstimada: 'no-es-fecha' })],
  ])('rechaza el alta: %s -> 400, y no se crea nada', async (_n, payload) => {
    const antes = await contar('pedidos');
    const res = await api.post('/pedidos/agregar', payload());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDACION');
    expect(await contar('pedidos')).toBe(antes);
  });

  test('sin usuario (ni header ni body) -> 400', async () => {
    const antes = await contar('pedidos');
    const res = await api.postSinUsuario('/pedidos/agregar', base());
    expect(res.status).toBe(400);
    expect(await contar('pedidos')).toBe(antes);
  });

  // #7: la identidad sale SOLO del header x-usuario-id (auditoria.ts: "nunca se completa"). Un idUsuario
  // en el body no reemplaza al header.
  test('idUsuario en el body pero SIN header -> 400 (el body no identifica al usuario)', async () => {
    const antes = await contar('pedidos');
    const res = await api.postSinUsuario('/pedidos/agregar', { ...base(), idUsuario: IDS.usuarioEmpleado });
    expect(res.status).toBe(400);
    expect(await contar('pedidos')).toBe(antes);
  });

  test('con header, el usuario del pedido es el del header aunque el body diga otro', async () => {
    const res = await api.post('/pedidos/agregar', { ...base(), idUsuario: IDS.usuarioEmpleado });
    expect(res.status).toBe(200);
    expect((await pedido(res.body.id)).idUsuario).toBe(IDS.usuarioAdmin);
  });
});

describe('Consulta', () => {
  test('obtener por estados (chip Activos) y por cliente, orden id DESC, con senaNeta y saldo', async () => {
    const cliente = IDS.clienteConSaldo;
    const a = await crearPedidoConSenia(250, { idCliente: cliente });
    const b = await crearPedido({ idCliente: cliente });
    expect((await api.put(`/pedidos/cancelar/${b}`, {})).status).toBe(200);
    const c = await crearPedido({ idCliente: cliente });
    expect((await api.put(`/pedidos/estado/${c}`, { estado: 'listo' })).status).toBe(200);

    const res = await api.post('/pedidos/obtener', { idCliente: cliente, estados: ['pendiente', 'en_proceso', 'listo'], tamanioPagina: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.registros.map((p: any) => p.id);
    expect(ids).toContain(a);
    expect(ids).toContain(c);
    expect(ids).not.toContain(b);
    expect([...ids].sort((x: number, y: number) => y - x)).toEqual(ids);
    expect(res.body.registros.every((p: any) => ['pendiente', 'en_proceso', 'listo'].includes(p.estado))).toBe(true);

    const pa = res.body.registros.find((p: any) => p.id === a);
    expect(pa).toMatchObject({ senaNeta: 250, saldo: 750, total: 1000 });
    expect(pa.cliente).toMatchObject({ id: cliente, telefono: '1155550001' });
  });

  test('detalle e historial por id', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/estado/${id}`, { estado: 'en_proceso', observacion: 'arrancamos' })).status).toBe(200);

    const det = await api.get(`/pedidos/detalle/${id}`);
    expect(det.status).toBe(200);
    expect(det.body).toHaveLength(1);
    expect(det.body[0]).toMatchObject({ idProducto: IDS.productoSimple, cantidad: 10, precio: 100, total: 1000 });

    const hist = await api.get(`/pedidos/historial/${id}`);
    expect(hist.status).toBe(200);
    expect(hist.body.map((h: any) => [h.estadoAnterior, h.estadoNuevo, h.observacion, h.usuario]))
      .toEqual([[null, 'pendiente', null, 'TEST ADMIN'], ['pendiente', 'en_proceso', 'arrancamos', 'TEST ADMIN']]);
  });

  test('PDF del pedido -> application/pdf', async () => {
    const id = await crearPedidoConSenia(100);
    const res = await api.post(`/pedidos/ver-pdf/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  test('PDF de un pedido inexistente -> 404', async () => {
    expect((await api.post('/pedidos/ver-pdf/999999')).status).toBe(404);
  });
});

describe('Edición (sin seña)', () => {
  test('reemplaza ítems y actualiza total, entrega estimada, observaciones, contacto y auditoría', async () => {
    const id = await crearPedido({ idCliente: CONSUMIDOR_FINAL, contactoNombre: 'Ana' });
    const items: Item[] = [{ idProducto: IDS.productoMultiprecio, cantidad: 3, precio: 200 }];
    const res = await api.put(`/pedidos/editar/${id}`, {
      ...pedidoPayload({ idCliente: CONSUMIDOR_FINAL, items, contactoNombre: 'Ana María', contactoTelefono: '111', observaciones: 'cambió' }),
      fechaEntregaEstimada: '2026-12-15',
    });
    expect(res.status).toBe(200);

    const p = await pedido(id);
    expect(p).toMatchObject({ total: '600.00', contactoNombre: 'Ana María', contactoTelefono: '111', observaciones: 'cambió',
                              idUsuarioModifico: IDS.usuarioAdmin, estado: 'pendiente' });
    expect(p.fechaModificacion).not.toBeNull();
    const fecha = (await q1<any>(`SELECT DATE_FORMAT(fechaEntregaEstimada, '%Y-%m-%d') AS f FROM pedidos WHERE id = ?`, [id])).f;
    expect(fecha).toBe('2026-12-15');
    expect((await detallesDb(id)).map(d => [d.idProducto, d.cantidad])).toEqual([[IDS.productoMultiprecio, '3.000']]);
    expect(await historial(id)).toHaveLength(1);                       // editar no es un cambio de estado
  });

  test('se puede editar en en_proceso y en listo', async () => {
    for (const estado of ['en_proceso', 'listo']) {
      const id = await crearPedido();
      expect((await api.put(`/pedidos/estado/${id}`, { estado })).status).toBe(200);
      const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ items: [{ idProducto: IDS.productoSimple, cantidad: 5, precio: 100 }] }));
      expect(res.status).toBe(200);
      expect((await pedido(id)).total).toBe('500.00');
    }
  });

  test.each([['cancelado'], ['entregado']])('no se puede editar un pedido %s (409) y no cambia', async (estado) => {
    const id = await crearPedido();
    if (estado === 'cancelado') expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(200);
    else expect((await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] })).status).toBe(200);
    const detAntes = await detallesDb(id);

    const res = await api.put(`/pedidos/editar/${id}`, pedidoPayload({ items: [{ idProducto: IDS.productoSimple, cantidad: 1, precio: 100 }] }));
    expect(res.status).toBe(409);
    expect((await pedido(id)).total).toBe('1000.00');
    expect(await detallesDb(id)).toEqual(detAntes);
  });

  test('editar un pedido inexistente -> 404', async () => {
    expect((await api.put('/pedidos/editar/999999', pedidoPayload())).status).toBe(404);
  });
});

describe('Transiciones de estado manuales', () => {
  test('pendiente -> en_proceso -> listo -> pendiente (hacia atrás también), todo en el historial', async () => {
    const id = await crearPedido();
    for (const [estado, obs] of [['en_proceso', 'empezó'], ['listo', null], ['pendiente', 'faltó una pieza']] as const) {
      const res = await api.put(`/pedidos/estado/${id}`, { estado, observacion: obs });
      expect(res.status).toBe(200);
      expect((await pedido(id)).estado).toBe(estado);
    }
    expect(await historial(id)).toEqual([
      { estadoAnterior: null, estadoNuevo: 'pendiente', observacion: null },
      { estadoAnterior: 'pendiente', estadoNuevo: 'en_proceso', observacion: 'empezó' },
      { estadoAnterior: 'en_proceso', estadoNuevo: 'listo', observacion: null },
      { estadoAnterior: 'listo', estadoNuevo: 'pendiente', observacion: 'faltó una pieza' },
    ]);
    expect(await contar('eventos', "accion = 'PEDIDO_ESTADO' AND entidadId = ?", [id])).toBe(3);
  });

  test.each([['entregado'], ['cancelado'], ['inventado'], [undefined]])('a mano no se puede pasar a %s (400)', async (estado) => {
    const id = await crearPedido();
    const res = await api.put(`/pedidos/estado/${id}`, { estado });
    expect(res.status).toBe(400);
    expect((await pedido(id)).estado).toBe('pendiente');
    expect(await historial(id)).toHaveLength(1);
  });

  test('pasar al mismo estado -> 409', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/estado/${id}`, { estado: 'pendiente' })).status).toBe(409);
    expect(await historial(id)).toHaveLength(1);
  });

  test.each([['cancelado'], ['entregado']])('un pedido %s es terminal: no cambia de estado (409)', async (terminal) => {
    const id = await crearPedido();
    if (terminal === 'cancelado') expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(200);
    else expect((await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] })).status).toBe(200);
    const histAntes = await historial(id);

    const res = await api.put(`/pedidos/estado/${id}`, { estado: 'listo' });
    expect(res.status).toBe(409);
    expect((await pedido(id)).estado).toBe(terminal);
    expect(await historial(id)).toEqual(histAntes);
  });

  test('estado de un pedido inexistente -> 404', async () => {
    expect((await api.put('/pedidos/estado/999999', { estado: 'listo' })).status).toBe(404);
  });

  test('observación de más de 255 caracteres -> 400', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/estado/${id}`, { estado: 'listo', observacion: 'x'.repeat(256) })).status).toBe(400);
    expect((await pedido(id)).estado).toBe('pendiente');
  });
});

describe('Cancelar sin seña', () => {
  test('cancela, guarda motivo/usuario/fecha, historial con el motivo, sin destinoSenia ni pagos', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/estado/${id}`, { estado: 'en_proceso' })).status).toBe(200);
    const res = await api.put(`/pedidos/cancelar/${id}`, { motivo: 'se arrepintió' });
    expect(res.status).toBe(200);

    const p = await pedido(id);
    expect(p).toMatchObject({ estado: 'cancelado', motivoCancelacion: 'se arrepintió', idUsuarioCancelo: IDS.usuarioAdmin, destinoSenia: null });
    expect(p.fechaCancelacion).not.toBeNull();
    const h = await historial(id);
    expect(h[h.length - 1]).toEqual({ estadoAnterior: 'en_proceso', estadoNuevo: 'cancelado', observacion: 'se arrepintió' });
    expect(await contar('pedidos_pagos', 'idPedido = ?', [id])).toBe(0);
  });

  test('cancelar dos veces -> 409', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(200);
    expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(409);
  });

  test('cancelar un pedido entregado -> 409', async () => {
    const id = await crearPedido();
    expect((await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] })).status).toBe(200);
    expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(409);
    expect((await pedido(id)).estado).toBe('entregado');
  });

  test('destino de seña inválido -> 400', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'regalada' })).status).toBe(400);
    expect((await pedido(id)).estado).toBe('pendiente');
  });
});

describe('Pagos sobre pedidos terminales y montos inválidos', () => {
  test('pago a cuenta en un pedido cancelado -> 409', async () => {
    const id = await crearPedido();
    expect((await api.put(`/pedidos/cancelar/${id}`, {})).status).toBe(200);
    expect((await api.post(`/pedidos/pagos/${id}`, { monto: 100, idTipoPago: TP.TRANSFERENCIA })).status).toBe(409);
    expect(await contar('pedidos_pagos', 'idPedido = ?', [id])).toBe(0);
  });

  test.each([[0], [-50]])('pago a cuenta con monto %d -> 400', async (monto) => {
    const id = await crearPedido();
    expect((await api.post(`/pedidos/pagos/${id}`, { monto, idTipoPago: TP.TRANSFERENCIA })).status).toBe(400);
    expect(await contar('pedidos_pagos', 'idPedido = ?', [id])).toBe(0);
  });

  test('anular un pago de un pedido ya entregado -> 409', async () => {
    const id = await crearPedidoConSenia(300);
    const [pago] = await q<any>('SELECT id FROM pedidos_pagos WHERE idPedido = ?', [id]);
    expect((await entregar({ idPedido: id, pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }] })).status).toBe(200);
    expect((await api.put(`/pedidos/pagos/anular/${pago.id}`)).status).toBe(409);
    expect((await q1<any>('SELECT anulado FROM pedidos_pagos WHERE id = ?', [pago.id])).anulado).toBe(0);
  });
});

describe('Venta con pedido y presupuesto a la vez', () => {
  const ventaConAmbos = (idPedido: number, idPresupuesto: number) =>
    api.post('/ventas/agregar', { ...ventaPayload({ idPedido, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] }), idPresupuesto });

  test('con un presupuesto vigente -> 400; no se crea la venta y ninguno de los dos cambia', async () => {
    const id = await crearPedido();
    const idPres = await insertar(
      `INSERT INTO presupuestos (idCliente, idUsuario, fecha, validezHasta, total, estado)
       VALUES (?, ?, CURDATE(), CURDATE() + INTERVAL 10 DAY, 1000, 'vigente')`, [IDS.clienteSinSaldo, IDS.usuarioAdmin]);
    const antes = await contar('ventas');

    const res = await ventaConAmbos(id, idPres);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/pedido y de un presupuesto/);
    expect(await contar('ventas')).toBe(antes);
    expect((await pedido(id)).estado).toBe('pendiente');
    expect((await q1<any>('SELECT estado FROM presupuestos WHERE id = ?', [idPres])).estado).toBe('vigente');
  });

  // HALLAZGO (preexistente, de presupuestos; NO corregido). ventasRepository.Agregar valida el presupuesto
  // ANTES que la regla pedido+presupuesto, y si el presupuesto no existe / no está vigente tira un `new Error`
  // (no AppError): la ruta lo convierte en 500 "Error al intentar agregar la venta." y el usuario no ve el
  // motivo. La venta no se crea (sin daño en la base). Pasa igual en una venta SOLO desde presupuesto.
  // Este test afirma el comportamiento ACTUAL (con el bug).
  test('BUG presupuesto: venta con pedido + presupuesto inexistente', async () => {
    const id = await crearPedido();
    const antes = await contar('ventas');
    const res = await ventaConAmbos(id, 999999);
    expect(res.status).toBe(500);                                       // BUG: debería ser 400 (regla pedido+presupuesto)
    expect(res.body.message).toBe('Error al intentar agregar la venta.'); // BUG: debería explicar el motivo
    expect(await contar('ventas')).toBe(antes);
    expect((await pedido(id)).estado).toBe('pendiente');
  });
});

describe('Eliminar cliente / producto referenciados solo por un pedido', () => {
  test('cliente con un pedido -> baja lógica (no error de FK, no borrado físico)', async () => {
    const idCliente = await insertar(`INSERT INTO clientes (nombre, tipoDocumento, condicionIva) VALUES ('CLIENTE TEST BORRABLE', 99, 5)`);
    await crearPedido({ idCliente });

    const del = await api.delete(`/clientes/eliminar/${idCliente}`);
    expect(del.status).toBe(200);
    expect(JSON.stringify(del.body)).toMatch(/BAJA/);
    expect((await q1<any>('SELECT fechaBaja FROM clientes WHERE id = ?', [idCliente])).fechaBaja).not.toBeNull();
  });

  test('producto con un pedido -> baja lógica', async () => {
    const idProducto = await insertar(`INSERT INTO productos (codigo, nombre, cantidad, tipoPrecio, costo, precio, unidad, soloPrecio, idCategoria)
                                       VALUES ('T-BORRABLE', 'PRODUCTO TEST BORRABLE', 0, '$', 10, 20, 'UNI', 0, 1)`);
    await q(`INSERT INTO productos_precios (idProducto, idLista, tipoPrecio, costo, precio) VALUES (?, 1, '$', 10, 20)`, [idProducto]);
    await crearPedido({ items: [{ idProducto, nombre: 'PRODUCTO TEST BORRABLE', cantidad: 1, precio: 20 }] });

    const del = await api.delete(`/productos/eliminar/${idProducto}`);
    expect(del.status).toBe(200);
    expect(JSON.stringify(del.body)).toMatch(/BAJA/);
    expect((await q1<any>('SELECT fechaBaja FROM productos WHERE id = ?', [idProducto])).fechaBaja).not.toBeNull();
  });
});
