import { Cliente } from "./Cliente";
import { DetalleVenta } from "./DetalleVenta";
import { FacturaVenta } from "./FacturaVenta";
import { pagoVenta } from "./PagoVenta";

export class Venta {
    id?: number;
    idCaja?: number;
    fecha?: Date;
    hora?: string;
    total?:number;

    cliente?: Cliente;
    pago?: pagoVenta;
    factura?: FacturaVenta;
    detalles?: DetalleVenta[];
}