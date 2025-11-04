import { Producto } from "./Producto";

export class DetalleVenta {
    id?: number;
    producto?: Producto;
    nomProd?: string;
    cantidad?: number;
    precio?: number;
    costo?: number;
    total?:number;
   
    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.cantidad = data.cantidad;
          this.nomProd = data.nomProd;
          this.precio = data.precio;
          this.costo = data.costo;
          this.total = data.total;
        }
    }
}