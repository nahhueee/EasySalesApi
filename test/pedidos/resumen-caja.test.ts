// Pedidos x resumen de caja (handoff_pedidos.md CA-27 a CA-32, decisión de Nahu 2026-11-24: el resumen de caja
// entra al alcance de Pedidos solo con estos criterios y tests).
// "Efectivo esperado" = resumen.cajon.esperado (ResumenCajaServ.Calcular), que es lo que usa el cierre
// (PUT /cajas/:id/cerrar). Cada test usa cajas propias (crearCaja) para no depender de la caja compartida.
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { api, crearPedidoConSenia, crearPedido, entregar, ventaPayload } from '../helpers/api';
import { crearCaja, pagos } from '../helpers/db';
import { CONSUMIDOR_FINAL, IDS, TP } from '../helpers/ids';
import { ResumenCajaServ } from '../../src/services/resumenCajaService';

const resumen = async (idCaja: number) => {
  const res = await api.get(`/cajas/${idCaja}/resumen`);
  expect(res.status).toBe(200);
  return res.body;
};
const cerrarConContado = (idCaja: number, efectivoContado: number) => api.put(`/cajas/${idCaja}/cerrar`, { efectivoContado });

describe('Resumen de caja con señas de pedidos', () => {
  test('CA-27: seña en efectivo aparece en "Señas de pedidos" y suma al efectivo esperado del cierre', async () => {
    const idCaja = await crearCaja(false, 1000);
    await crearPedidoConSenia(300, { idCaja });

    const r = await resumen(idCaja);
    expect(r.cajon).toMatchObject({ cambioInicial: 1000, ventasEfectivo: 0, senias: 300, esperado: 1300 });

    const cierre = await cerrarConContado(idCaja, 1300);
    expect(cierre.status).toBe(200);
    expect(cierre.body).toMatchObject({ esperado: 1300, contado: 1300, diferencia: 0 });
  });

  // CA-28 (§2.10, 2026-11-24; resuelve el GAP): la seña por otro medio entra en "Otros medios" de la caja donde se
  // cobró, en la misma fila que las ventas de ese medio, y NO en el efectivo esperado.
  test('CA-28: seña por transferencia suma a "Otros medios" de su caja y NO al efectivo esperado', async () => {
    const idCaja = await crearCaja(false, 1000);
    await crearPedido({ idCaja, senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja } });

    const r = await resumen(idCaja);
    expect(r.cajon).toMatchObject({ senias: 0, esperado: 1000 });
    expect(r.otrosMedios).toEqual([expect.objectContaining({ medio: 'TRANSFERENCIA', cantidadVentas: 0, cantidadSenias: 1, total: 200 })]);
    const cierre = await cerrarConContado(idCaja, 1000);
    expect(cierre.body).toMatchObject({ esperado: 1000, diferencia: 0 });
  });

  test('CA-28: una seña por transferencia anulada no suma', async () => {
    const idCaja = await crearCaja(false, 1000);
    const id = await crearPedido({ idCaja, senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja } });
    const [pago] = await pagos(id);
    expect((await api.put(`/pedidos/pagos/anular/${pago.id}`)).status).toBe(200);

    const r = await resumen(idCaja);
    expect(r.otrosMedios).toEqual([]);
    expect(r.cajon.esperado).toBe(1000);
  });

  test('CA-28: ventas y señas del mismo medio van en la misma fila, con cantidades separadas', async () => {
    const idCaja = await crearCaja(false, 1000);
    await crearPedido({ idCaja, senia: { monto: 200, idTipoPago: TP.TRANSFERENCIA, idCaja } });
    expect((await api.post('/ventas/agregar', ventaPayload({ idCaja, idCliente: CONSUMIDOR_FINAL,
      items: [{ idProducto: IDS.productoSimple, cantidad: 5, precio: 100 }],
      pagos: [{ idTipoPago: TP.TRANSFERENCIA, monto: 500 }] }))).status).toBe(200);

    const r = await resumen(idCaja);
    expect(r.otrosMedios).toEqual([expect.objectContaining({ medio: 'TRANSFERENCIA', cantidadVentas: 1, cantidadSenias: 1, total: 700 })]);
    expect(r.cajon.esperado).toBe(1000);
  });

  test('CA-29: seña devuelta al cancelar resta del efectivo esperado de la caja de la devolución', async () => {
    const cajaCobro = await crearCaja(false, 1000);
    const cajaDevolucion = await crearCaja(false, 1000);
    const id = await crearPedidoConSenia(300, { idCaja: cajaCobro });

    const cancel = await api.put(`/pedidos/cancelar/${id}`, { destinoSenia: 'devuelta', idCaja: cajaDevolucion });
    expect(cancel.status).toBe(200);

    const rDev = await resumen(cajaDevolucion);
    expect(rDev.cajon).toMatchObject({ senias: -300, esperado: 700 });
    const rCobro = await resumen(cajaCobro);                 // la caja donde se cobró no cambia
    expect(rCobro.cajon).toMatchObject({ senias: 300, esperado: 1300 });

    const cierre = await cerrarConContado(cajaDevolucion, 700);
    expect(cierre.body).toMatchObject({ esperado: 700, diferencia: 0 });
  });

  test('CA-30: seña anulada compensa: el resumen queda igual que si la seña no hubiera existido', async () => {
    const cajaConSenia = await crearCaja(false, 1000);
    const cajaGemela = await crearCaja(false, 1000);       // misma caja, sin seña
    const id = await crearPedidoConSenia(300, { idCaja: cajaConSenia });
    const [pago] = await pagos(id);
    expect((await api.put(`/pedidos/pagos/anular/${pago.id}`)).status).toBe(200);

    const r = await resumen(cajaConSenia);
    expect(r.cajon).toMatchObject({ senias: 0, esperado: 1000 });
    expect(r.cajon).toEqual((await resumen(cajaGemela)).cajon);
  });

  test('CA-31: seña en caja 1 y entrega en caja 2: cada caja cierra con lo suyo', async () => {
    const caja1 = await crearCaja(false, 1000);
    const caja2 = await crearCaja(false, 500);
    const id = await crearPedidoConSenia(300, { idCaja: caja1 });
    const venta = await entregar({ idPedido: id, idCaja: caja2,
      pagos: [{ idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 700 }] });
    expect(venta.status).toBe(200);

    const r1 = await resumen(caja1);
    expect(r1.cajon).toMatchObject({ ventasEfectivo: 0, senias: 300, esperado: 1300 });
    expect(r1.info).toMatchObject({ totalVendido: 0, cantidadVentas: 0 });

    const r2 = await resumen(caja2);
    expect(r2.cajon).toMatchObject({ ventasEfectivo: 700, senias: 0, esperado: 1200 });
    // Actualizado 2026-11-24 (handoff_pedidos.md §2.10, CA-31): lo aplicado con seña sale de "Otros medios" (no es
    // plata del posnet ni del banco) y va a la línea informativa info.aplicadoSenias. Antes: otrosMedios = [SEÑA 300].
    expect(r2.info).toMatchObject({ totalVendido: 1000, cantidadVentas: 1, fiado: 0, aplicadoSenias: 300 });
    expect(r2.otrosMedios).toEqual([]);

    expect((await cerrarConContado(caja1, 1300)).body).toMatchObject({ esperado: 1300, diferencia: 0 });
    expect((await cerrarConContado(caja2, 1200)).body).toMatchObject({ esperado: 1200, diferencia: 0 });
  });

  test('CA-33: "Aplicado de señas" queda fuera del esperado y el total del resumen cuadra', async () => {
    const cajaSenia = await crearCaja(false, 0);
    const idCaja = await crearCaja(false, 0);
    const id = await crearPedidoConSenia(300, { idCaja: cajaSenia });
    // Entrega: SEÑA 300 + EFECTIVO 400 + TARJETA 300 = 1000.
    expect((await entregar({ idPedido: id, idCaja, pagos: [
      { idTipoPago: TP.SENIA, monto: 300 }, { idTipoPago: TP.EFECTIVO, monto: 400 }, { idTipoPago: TP.TARJETA, monto: 300 }] })).status).toBe(200);
    // Venta CF por QR 500 y venta fiada de 200 al cliente 3.
    const vender = (o: Parameters<typeof ventaPayload>[0]) => api.post('/ventas/agregar', ventaPayload({ idCaja, ...o }));
    expect((await vender({ idCliente: CONSUMIDOR_FINAL, items: [{ idProducto: IDS.productoSimple, cantidad: 5, precio: 100 }],
                           pagos: [{ idTipoPago: TP.QR, monto: 500 }] })).status).toBe(200);
    expect((await vender({ idCliente: IDS.clienteSinSaldo, items: [{ idProducto: IDS.productoSimple, cantidad: 2, precio: 100 }],
                           pagos: [{ idTipoPago: TP.CC, monto: 0 }], realizado: false })).status).toBe(200);

    const r = await resumen(idCaja);
    expect(r.info.aplicadoSenias).toBe(300);
    expect(r.otrosMedios.map((m: any) => [m.medio, m.total]).sort()).toEqual([['QR', 500], ['TARJETA', 300]]);
    expect(r.cajon.esperado).toBe(400);

    const sumaOtros = r.otrosMedios.reduce((s: number, m: any) => s + m.total, 0);
    expect(r.cajon.ventasEfectivo + sumaOtros + r.info.aplicadoSenias + r.info.fiado + r.info.saldoAFavorUsado)
      .toBe(r.info.totalVendido);
    expect(r.info.totalVendido).toBe(1700);
  });
});

describe('CA-32: una caja sin pedidos da el mismo resumen que antes de Pedidos (sin regresión)', () => {
  // Versión del servicio en el commit base del handoff (antes de Pedidos), sacada de git y cargada desde un temporal
  // con los imports apuntando a src/ de hoy (misma base, mismo pool).
  const COMMIT_BASE = '213a6bf';
  const SRC = path.resolve(__dirname, '..', '..', 'src').split(path.sep).join('/');
  let archivoBase = '';
  let ResumenBase: any;

  beforeAll(() => {
    const codigo = execSync(`git show ${COMMIT_BASE}:src/services/resumenCajaService.ts`,
      { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' })
      .replace(/from '\.\.\/([^']+)'/g, (_m, ruta) => `from '${SRC}/${ruta}'`);
    // Dentro del proyecto (test/.tmp, en .gitignore) para que resuelva node_modules.
    const dirTmp = path.resolve(__dirname, '..', '.tmp');
    fs.mkdirSync(dirTmp, { recursive: true });
    archivoBase = path.join(fs.mkdtempSync(path.join(dirTmp, 'resumen-base-')), 'resumenCajaServiceBase.ts');
    fs.writeFileSync(archivoBase, codigo, 'utf8');
    ResumenBase = require(archivoBase).ResumenCajaServ;
  });
  afterAll(() => { if (archivoBase) fs.rmSync(path.dirname(archivoBase), { recursive: true, force: true }); });

  test('ventas en efectivo, con tarjeta y fiadas, más ingresos y egresos manuales: igual a la versión base', async () => {
    const idCaja = await crearCaja(false, 2000);
    const vender = (o: Parameters<typeof ventaPayload>[0]) => api.post('/ventas/agregar', ventaPayload({ idCaja, ...o }));
    expect((await vender({ idCliente: CONSUMIDOR_FINAL, pagos: [{ idTipoPago: TP.EFECTIVO, monto: 1000 }] })).status).toBe(200);
    expect((await vender({ idCliente: CONSUMIDOR_FINAL, items: [{ idProducto: IDS.productoSimple, cantidad: 5, precio: 100 }],
                           pagos: [{ idTipoPago: TP.TARJETA, monto: 500 }] })).status).toBe(200);
    expect((await vender({ idCliente: IDS.clienteSinSaldo, items: [{ idProducto: IDS.productoSimple, cantidad: 2, precio: 100 }],
                           pagos: [{ idTipoPago: TP.CC, monto: 0 }], realizado: false })).status).toBe(200);
    expect((await api.post('/movimientos/agregar', { idCaja, tipoMovimiento: 'ENTRADA', monto: 200, descripcion: 'cambio' })).status).toBe(200);
    expect((await api.post('/movimientos/agregar', { idCaja, tipoMovimiento: 'SALIDA', monto: 50, descripcion: 'flete' })).status).toBe(200);

    const base = await ResumenBase.Calcular(idCaja);
    const hoy = await ResumenCajaServ.Calcular(idCaja);

    // Se cargó de verdad la versión de antes de Pedidos (no tiene la línea senias).
    expect(base.cajon).not.toHaveProperty('senias');
    // Lo único nuevo son cajon.senias e info.aplicadoSenias (en 0) y otrosMedios[].cantidadSenias (en 0, §2.10);
    // todo lo demás, idéntico.
    expect(hoy.cajon.senias).toBe(0);
    expect(hoy.info.aplicadoSenias).toBe(0);
    expect(hoy.otrosMedios.every((m: any) => m.cantidadSenias === 0)).toBe(true);
    const { senias: _s, ...cajonSinSenias } = hoy.cajon;
    const { aplicadoSenias: _a, ...infoSinAplicado } = hoy.info;
    const otrosSinSenias = hoy.otrosMedios.map(({ cantidadSenias: _c, ...m }: any) => m);
    expect({ ...hoy, cajon: cajonSinSenias, info: infoSinAplicado, otrosMedios: otrosSinSenias }).toEqual(base);

    // Y los números son los esperables: 2000 + 1000 efectivo + 200 - 50.
    expect(hoy.cajon).toMatchObject({ ventasEfectivo: 1000, ingresos: 200, egresos: 50, esperado: 3150 });
    expect(hoy.info).toMatchObject({ totalVendido: 1700, cantidadVentas: 3, fiado: 200 });
    // La respuesta HTTP es la misma que el servicio.
    expect(await resumen(idCaja)).toEqual(JSON.parse(JSON.stringify(hoy)));
  });
});
