export class ListaPrecio {
  id: number = 0;
  nombre?: string;
  esDefault?: boolean;
  activa?: boolean;

  constructor(data?: any) {
    if (data) {
      this.id       = data.id;
      this.nombre   = data.nombre;
      this.esDefault = data.esDefault ? true : false;
      this.activa   = data.activa   ? true : false;
    }
  }
}
