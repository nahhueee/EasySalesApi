export class ObjComprobante {
    papel?:string;
    margenIzq:number = 0;
    margenDer:number = 0;
    nombreLocal?:string;
    desLocal?:string;
    dirLocal?:string;
    fechaVenta?:string;
    horaVenta?:string;
    descuento?:number;
    recargo?:number;
    filasTabla?:any[];
    totalProductos?:number;
    totalFinal?:number;
}