import { Producto } from "./Producto";

export class DetalleVenta {
    id?: number;
    idVenta?: number;
    producto?: Producto;
    nomProd?: string;
    cantidad?: number;
    precio?: number;
    costo?: number;
    total?:number;
   
    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.idVenta = data.idVenta;
          this.producto = data.producto;
          this.cantidad = data.cantidad;
          this.nomProd = data.nomProd;
          this.precio = data.precio;
          this.costo = data.costo;
          this.total = data.total;
        }
    }
}