import { Producto } from "./Producto";

export class DetalleVenta {
    id?: number;
    producto?: Producto;
    cantidad?: number;
    precio?: number;
    costo?: number;
    total?:number;
   
    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.cantidad = data.cantidad;
          this.precio = data.precio;
          this.costo = data.costo;
          this.total = data.total;
        }
    }
}