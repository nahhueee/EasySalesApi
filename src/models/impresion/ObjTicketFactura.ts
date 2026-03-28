export class ObjTicketFactura {
    tipoComprobante?:number;
    desTipoComprobante?:string;
    CUIL?:number;
    condicion?:string;
    puntoVta?:number;
    ticket?:number;
    neto?:number;
    iva?:number;
    cae?:string;
    caeVto?:string;
    direccion?:string;
    razon?:string;
    qr?:string;

    //Receptor
    DNI?:number;
    tipoDNI?:number;
    condReceptor?: string;
    
    constructor(data?: any) {
        if (data) {
          this.tipoComprobante = data.tipoComprobante;
          this.desTipoComprobante = data.desTipoComprobante;
          this.CUIL = data.CUIL;
          this.condicion = data.condicion;
          this.puntoVta = data.puntoVta;
          this.ticket = data.ticket;
          this.neto = data.neto;
          this.iva = data.iva;
          this.cae = data.cae;
          this.caeVto = data.caeVto;
          this.direccion = data.direccion;
          this.razon = data.razon;
          this.qr = data.qr;

          this.DNI = data.DNI;
          this.tipoDNI = data.tipoDNI;
          this.condReceptor = data.condReceptor;
        }
    }
}