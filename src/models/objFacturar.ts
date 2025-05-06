export class ObjFacturar {
    total?:number;
    tipoFactura?:number;
    docNro?:number;
    docTipo?:number;

    constructor(data?: any) {
        if (data) {
          this.total = data.total;
          this.tipoFactura = data.tipoFactura;
          this.docNro = data.docNro;
          this.docTipo = data.docTipo;
        }
    }
}