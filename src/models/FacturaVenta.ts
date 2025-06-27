export class FacturaVenta{
    cae?: string;
    caeVto?: Date;
    ticket? : number;
    tipoFactura? : number;
    neto? : number;
    iva? : number;
    dni? : number;
    tipoDni? : number;
    ptoVenta? : number;
    condReceptor? : number;

    constructor(data?: any) {
      if (data) {
        this.cae = data.cae;
        this.caeVto = data.caeVto;
        this.ticket = data.ticket;
        this.tipoFactura = data.tipoFactura;
        this.neto = data.neto;
        this.iva = data.iva;
        this.dni = data.dni;
        this.tipoDni = data.tipoDni;
        this.ptoVenta = data.ptoVenta;
        this.condReceptor = data.condReceptor;
      }
    }
}
  
  