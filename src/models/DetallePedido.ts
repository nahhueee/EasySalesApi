import { Producto } from './Producto';

export class DetallePedido {
    id?: number;
    idPedido?: number;
    idProducto: number = 0;    // Producto real o VARIOS ('*'), igual que presupuestos
    nomProd: string = '';      // Snapshot del nombre al momento de pactar
    cantidad: number = 0;
    precio: number = 0;        // Snapshot del precio pactado (con seña queda congelado)
    costo: number = 0;
    total: number = 0;

    producto?: Producto;       // Solo lectura (detalle enriquecido)
}
