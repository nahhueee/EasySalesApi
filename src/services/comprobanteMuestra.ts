/**
 * Datos de EJEMPLO para la vista previa de comprobantes (Preferencias > Impresión).
 * No son datos reales ni se persisten: existen solo para que el usuario vea cómo queda el
 * formato antes de guardar. Se arman con Object.assign sobre los modelos reales para que un
 * cambio de forma en Venta/Presupuesto rompa acá en compilación y no en silencio.
 */
import { Venta } from '../models/Venta';
import { DetalleVenta } from '../models/DetalleVenta';
import { Presupuesto } from '../models/Presupuesto';
import { DetallePresupuesto } from '../models/DetallePresupuesto';

const ITEMS = [
  { nomProd: 'Coca Cola 1.5L',        cantidad: 2, precio: 2500 },
  { nomProd: 'Alfajor triple',        cantidad: 3, precio: 900 },
  { nomProd: 'Yerba mate 1kg',        cantidad: 1, precio: 6200 },
];

const total = ITEMS.reduce((acc, i) => acc + i.cantidad * i.precio, 0);

export function ventaMuestra(): Venta {
  const detalles = ITEMS.map(i => Object.assign(new DetalleVenta(), { ...i, total: i.cantidad * i.precio }));

  return Object.assign(new Venta(), {
    id:    0,
    fecha: new Date(),
    hora:  new Date().toLocaleTimeString('es-AR'),
    total,
    detalles,
    pago:        { monto: total, descuento: 0, recargo: 0 },
    // DetallePago exige un TipoPago completo; para renderizar solo se lee nombre y monto.
    detallePago: [{ tipoPago: { nombre: 'Efectivo' }, monto: total }] as any,
  });
}

export function presupuestoMuestra(): Presupuesto {
  const vence = new Date();
  vence.setDate(vence.getDate() + 7);

  return Object.assign(new Presupuesto(), {
    id: 1,
    fecha: new Date(),
    validezHasta: vence,
    total,
    cliente: { nombre: 'Cliente de ejemplo' } as any,
  });
}

export function detallesPresupuestoMuestra(): DetallePresupuesto[] {
  return ITEMS.map(i => Object.assign(new DetallePresupuesto(), { ...i, total: i.cantidad * i.precio }));
}

export const TOTAL_MUESTRA = total;
