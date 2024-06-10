import { Cliente } from "./Cliente";
import { DetalleVenta } from "./DetalleVenta";
import { pagoVenta } from "./PagoVenta";

export class Venta {
    id?: number;
    idCaja?: number;
    fecha?: Date;
    hora?: string;
    total?:number;

    cliente?: Cliente;
    pago?: pagoVenta;
    detalles?: DetalleVenta[];
}