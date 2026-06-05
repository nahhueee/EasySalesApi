export class FacturaVenta{
    idVenta? : number;
    cae?: string;
    caeVto?: Date;
    ticket? : number;
    tipoComprobante? : number;
    neto? : number;
    iva? : number;
    dni? : number;
    tipoDni? : number;
    tipoDniDesc? : string;
    ptoVenta? : number;
    condReceptor? : number;

    constructor(data?: any) {
      if (data) {
        this.idVenta = data.idVenta;
        this.cae = data.cae;
        this.caeVto = data.caeVto;
        this.ticket = data.ticket;
        this.tipoComprobante = data.tipoComprobante;
        this.neto = data.neto;
        this.iva = data.iva;
        this.dni = data.dni;
        this.tipoDni = data.tipoDni;
        this.ptoVenta = data.ptoVenta;
        this.condReceptor = data.condReceptor;
      }
    }
}
  
  