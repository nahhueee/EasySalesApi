export class ObjTicketFactura {
    impreso?:boolean;
    tipoFactura?:string;
    fecha?:string;
    cuit?:number;
    condicion?:string;
    puntoVta?:number;
    ticket?:number;
    iva?:string;
    cae?:string;
    caeVto?:string;
    direccion?:string;
    
    constructor(data?: any) {
        if (data) {
          this.impreso = data.impreso;
          this.tipoFactura = data.tipoFactura;
          this.fecha = data.fecha;
          this.cuit = data.cuit;
          this.condicion = data.condicion;
          this.puntoVta = data.puntoVta;
          this.ticket = data.ticket;
          this.iva = data.iva;
          this.cae = data.cae;
          this.caeVto = data.caeVto;
          this.direccion = data.direccion;
        }
    }
}