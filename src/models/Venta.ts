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

    cliente: Cliente = new Cliente();
    pago: pagoVenta = new pagoVenta();
    detallePago: DetallePago[] = []; 
    factura?: FacturaVenta;
    detalles: DetalleVenta[] = [];
}