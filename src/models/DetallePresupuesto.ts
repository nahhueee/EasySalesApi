import { Producto } from './Producto';

export class DetallePresupuesto {
    id?: number;
    idPresupuesto?: number;
    idProducto: number = 0;    // Solo productos reales — los ad-hoc (vario, soloPrecio) no se presupuestan
    nomProd: string = '';      // Snapshot del nombre al momento de cotizar
    cantidad: number = 0;
    precio: number = 0;        // Snapshot del precio cotizado
    costo: number = 0;
    total: number = 0;

    producto?: Producto;       // Sólo se usa para lectura (detalle enriquecido)
}
