// Cliente HTTP contra la app real (supertest, sin listen). La "auth" del backend es el header
// x-usuario-id (no hay token): por defecto, el usuario de prueba TEST ADMIN.
import request from 'supertest';
import app from '../../src/index';
import { IDS, TP, TP_NOMBRE, CONSUMIDOR_FINAL } from './ids';

const BASE = '/easysales';
const conUsuario = (r: request.Test, usuario: number) => r.set('x-usuario-id', String(usuario));

export const api = {
  get: (url: string, usuario = IDS.usuarioAdmin) => conUsuario(request(app).get(BASE + url), usuario),
  post: (url: string, body: any = {}, usuario = IDS.usuarioAdmin) => conUsuario(request(app).post(BASE + url), usuario).send(body),
  put: (url: string, body: any = {}, usuario = IDS.usuarioAdmin) => conUsuario(request(app).put(BASE + url), usuario).send(body),
  delete: (url: string, usuario = IDS.usuarioAdmin) => conUsuario(request(app).delete(BASE + url), usuario),
  /** Sin header x-usuario-id (request "anónima"). */
  postSinUsuario: (url: string, body: any = {}) => request(app).post(BASE + url).send(body),
};

// ---------- builders de payload ----------
export type Item = { idProducto: number; nombre?: string; cantidad: number; precio: number; costo?: number };

const NOMBRES: Record<number, string> = {
  [IDS.productoSimple]: 'PRODUCTO TEST SIMPLE',
  [IDS.productoMultiprecio]: 'PRODUCTO TEST MULTIPRECIO',
};

/** 10 x PRODUCTO SIMPLE a $100 = $1000. */
export const ITEMS_1000: Item[] = [{ idProducto: IDS.productoSimple, cantidad: 10, precio: 100 }];

export function detallesPedido(items: Item[]) {
  return items.map(i => ({
    idProducto: i.idProducto, nomProd: i.nombre ?? NOMBRES[i.idProducto] ?? 'X',
    cantidad: i.cantidad, precio: i.precio, costo: i.costo ?? 0, total: i.cantidad * i.precio,
  }));
}
export const totalDe = (items: Item[]) => items.reduce((s, i) => s + i.cantidad * i.precio, 0);

export type OpcionesPedido = {
  idCliente?: number; items?: Item[]; senia?: { monto: number; idTipoPago: number; idCaja?: number | null };
  idCaja?: number; contactoNombre?: string; contactoTelefono?: string; observaciones?: string;
};

export function pedidoPayload(o: OpcionesPedido = {}) {
  const items = o.items ?? ITEMS_1000;
  return {
    idCliente: o.idCliente ?? IDS.clienteSinSaldo,
    idCaja: o.idCaja ?? IDS.cajaAbierta,
    total: totalDe(items),
    detalles: detallesPedido(items),
    contactoNombre: o.contactoNombre, contactoTelefono: o.contactoTelefono, observaciones: o.observaciones,
    senia: o.senia,
  };
}

/** Crea un pedido por la API y devuelve su id (tira si la API no responde 200). */
export async function crearPedido(o: OpcionesPedido = {}): Promise<number> {
  const res = await api.post('/pedidos/agregar', pedidoPayload(o));
  if (res.status !== 200) throw new Error(`crearPedido: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Pedido de $1000 con seña en efectivo en la caja abierta. */
export const crearPedidoConSenia = (monto: number, o: OpcionesPedido = {}) =>
  crearPedido({ ...o, senia: { monto, idTipoPago: TP.EFECTIVO, idCaja: o.idCaja ?? IDS.cajaAbierta } });

/**
 * Venta tal como la arma registrar-venta. `pagos` = detalles de pago (medio + monto).
 * CUENTA CORRIENTE va con monto 0 (así lo manda el front: no se guarda en el detalle).
 */
export function ventaPayload(o: {
  idPedido?: number; idCliente?: number; idCaja?: number; items?: Item[];
  pagos: { idTipoPago: number; monto: number }[]; realizado?: boolean;
}) {
  const items = o.items ?? ITEMS_1000;
  const total = totalDe(items);
  const pagado = o.pagos.filter(p => p.idTipoPago !== TP.CC).reduce((s, p) => s + p.monto, 0);
  const idCliente = o.idCliente ?? IDS.clienteSinSaldo;
  return {
    idCaja: o.idCaja ?? IDS.cajaAbierta,
    idPedido: o.idPedido,
    total,
    cliente: { id: idCliente, nombre: idCliente === CONSUMIDOR_FINAL ? 'CONSUMIDOR FINAL' : 'CLIENTE TEST' },
    pago: { monto: total, entrega: pagado, recargo: 0, descuento: 0, tipoModificador: null,
            realizado: o.realizado ?? pagado >= total, pagaCon: null },
    detallePago: o.pagos.map(p => ({ tipoPago: { id: p.idTipoPago, nombre: TP_NOMBRE[p.idTipoPago] }, monto: p.monto })),
    detalles: items.map(i => ({
      producto: { id: i.idProducto, nombre: i.nombre ?? NOMBRES[i.idProducto] ?? 'X' },
      cantidad: i.cantidad, precio: i.precio, costo: i.costo ?? 0, total: i.cantidad * i.precio,
    })),
  };
}

export const entregar = (o: Parameters<typeof ventaPayload>[0]) => api.post('/ventas/agregar', ventaPayload(o));
