export class TipoPago{
    id? : number;
    nombre? : string;
    color? : string;
    icono? : string;
    
    constructor(data?: any) {
      if (data) {
        this.id = data.id;
        this.nombre = data.nombre;
        this.color = data.color;
        this.icono = data.icono;
      }
    }
  }
  
  