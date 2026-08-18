const moment = require('moment');

export class Producto {
    id : number = 0;
    codigo? : string;
    nombre? : string;
    cantidad? : number;
    costo? : number;
    precio? : number;
    tipoPrecio? : string;
    sumarIva? : boolean;
    redondeo? : number;
    porcentaje? : number;
    vencimiento? : Date;
    faltante? : number;
    unidad? : string;
    imagen? : string;
    activo? : boolean;
    soloPrecio? : boolean;
    idCategoria? : number;
    // NULL = sin proveedor asignado (FK real, a diferencia de idCategoria que usa 0 + fila
    // sintética "Sin asignar" — ver migración 20260817120000_productos_id_proveedor.js).
    idProveedor? : number | null;

    constructor(data?: any) {
        if (data) {
            this.id = data.id;
            this.codigo = data.codigo;
            this.nombre = data.nombre;
            this.cantidad = parseFloat(data.cantidad);
            this.costo = parseFloat(data.costo);
            this.precio = parseFloat(data.precio);
            this.tipoPrecio = data.tipoPrecio;
            this.sumarIva = data.sumarIva ? true : false;
            this.redondeo = parseFloat(data.redondeo);
            this.porcentaje = parseFloat(data.porcentaje);
            this.vencimiento = moment(data.vencimiento).format('DD-MM-YYYY');
            this.faltante = data.faltante;
            this.unidad = data.unidad;
            this.imagen = data.imagen;
            this.soloPrecio = data.soloPrecio;
            this.idCategoria = data.idCategoria;
            this.idProveedor = data.idProveedor;
        }
    }
}