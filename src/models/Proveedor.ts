export class Proveedor {
    id?:number;
    nombre?:string;
    razonSocial?:string;
    cuit?:string;
    telefono?:string;
    email?:string;
    direccion?:string;

    constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.nombre = data.nombre;
          this.razonSocial = data.razonSocial;
          this.cuit = data.cuit;
          this.telefono = data.telefono;
          this.email = data.email;
          this.direccion = data.direccion;
        }
    }
}
