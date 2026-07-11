import { Cliente } from "./Cliente";
import { DetallePago } from "./DetallePago";
import { DetalleVenta } from "./DetalleVenta";
import { FacturaVenta } from "./FacturaVenta";
import { pagoVenta } from "./PagoVenta";

export class Venta {
    id: number = 0;
    idCaja: number = 0;
    fecha?: Date;
    hora?: string;
    total:number = 0;
    fechaBaja?: Date;
    obsBaja?: string;
    idPresupuesto?: number;    // Si la venta proviene de un presupuesto
    idLista?: number;          // Lista de precios efectivamente usada en la venta (null = Minorista)
    nombreLista?: string;      // Solo lectura (JOIN a listas_precio): para mostrar en el comprobante interno, ver Fase 4

    cliente: Cliente = new Cliente();
    pago: pagoVenta = new pagoVenta();
    detallePago: DetallePago[] = []; 
    factura?: FacturaVenta;
    detalles: DetalleVenta[] = [];
}