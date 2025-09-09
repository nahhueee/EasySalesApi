export class RegistroDetalle{
  id?: number;
  fecha? : Date;
  accion? : string;
  monto?: number;
  observacion?: string;

  constructor(data?: any) {
    if (data) {
      this.id = data.id;
      this.fecha = data.fecha;
      this.accion = data.accion;
      this.monto = data.monto;
      this.observacion = data.observacion;
    }
  }
}

