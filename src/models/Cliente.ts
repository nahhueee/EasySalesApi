export class Cliente {
    id?:number;
    nombre?:string;
    tipoDocumento?:number;
    nroDocumento?:number;
    condicionIva?:number;
    razonSocial?:string;
    direccion?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.nombre = data.nombre;
          this.tipoDocumento = data.tipoDocumento;
          this.nroDocumento = data.nroDocumento;
          this.condicionIva = data.condicionIva;
          this.razonSocial = data.razonSocial;
          this.direccion = data.direccion;
        }
    }
}