export class ProductoPrecio {
  id?: number;
  idProducto?: number;
  idLista?: number;
  nombreLista?: string;  // JOIN — no persiste
  esDefault?: boolean;   // JOIN — no persiste
  tipoPrecio?: string;
  costo?: number;
  precio?: number;
  porcentaje?: number;
  redondeo?: number;
  sumarIva?: boolean;

  constructor(data?: any) {
    if (data) {
      this.id         = data.id;
      this.idProducto = data.idProducto;
      this.idLista    = data.idLista;
      this.nombreLista = data.nombreLista;
      this.esDefault  = data.esDefault ? true : false;
      this.tipoPrecio = data.tipoPrecio;
      this.costo      = parseFloat(data.costo)      || 0;
      this.precio     = parseFloat(data.precio)     || 0;
      this.porcentaje = data.porcentaje != null ? parseFloat(data.porcentaje) : undefined;
      this.redondeo   = data.redondeo   != null ? parseInt(data.redondeo)     : 0;
      this.sumarIva   = data.sumarIva   ? true : false;
    }
  }
}
