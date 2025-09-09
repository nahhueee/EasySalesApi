import { RegistroDetalle } from "./DetalleRegistro";

export class Registro{
  id? : number;
  descripcion? : string;
  prioridad?:number;
  total?:number;  
  detalles?: RegistroDetalle[];

  constructor(data?: any) {
    if (data) {
      this.id = data.id;
      this.descripcion = data.descripcion;
      this.prioridad = data.prioridad;
      this.total = data.total;
      this.detalles = data.detalles;
    }
  }
}

