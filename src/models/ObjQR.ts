export class ObjQR {
    ver?:number;
    fecha?:Date;
    cuit?:number;
    ptoVenta?:number;
    tipoCmp?:number;
    nroCmp?:number;
    importe?:number;
    moneda?:string;
    ctz?:number;
    tipoDocRec?:number;
    nroDocRec?:number;
    tipoCodAut?:string;
    codAut?:string;

    constructor(data?: any) {
        if (data) {
          this.ver = data.ver;
          this.fecha = data.fecha;
          this.cuit = data.cuit;
          this.ptoVenta = data.ptoVenta;
          this.tipoCmp = data.tipoCmp;
          this.nroCmp = data.nroCmp;
          this.importe = data.importe;
          this.moneda = data.moneda;
          this.ctz = data.ctz;
          this.tipoDocRec = data.tipoDocRec;
          this.nroDocRec = data.nroDocRec;
          this.tipoCodAut = data.tipoCodAut;
          this.codAut = data.codAut;
        }
    }
}