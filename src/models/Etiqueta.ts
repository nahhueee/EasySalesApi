export class Etiqueta{
  id? : number;
  descripcion? : string;
  tamanio? : string;
  titulo?:string;
  mOferta?: boolean;
  mCodigo?: boolean;
  mPrecio?: boolean;
  mNombre?: boolean;
  mVencimiento?: boolean;

  bordeColor?: string;
  bordeAncho?: string;
  tituloColor?: string;
  tituloAlineacion?: string;
  ofertaFondo?: string;
  ofertaAlineacion?: string;
  nombreAlineacion?: string;
  vencimientoAlineacion?: string;
  precioAlineacion?: string;
  precioColor?: string;

  constructor(data?: any) {
      if (data) {
        this.id = data.id;
        this.descripcion = data.descripcion;
        this.tamanio = data.tamanio;
        this.titulo = data.titulo;
        this.mOferta = data.mOferta;
        this.mCodigo = data.mCodigo;
        this.mPrecio = data.mPrecio;
        this.mNombre = data.mNombre;
        this.mVencimiento = data.mVencimiento;
        
        this.bordeColor = data.bordeColor;
        this.bordeAncho = data.bordeAncho;
        this.tituloColor = data.tituloColor;
        this.tituloAlineacion = data.tituloAlineacion;
        this.ofertaFondo = data.ofertaFondo;
        this.ofertaAlineacion = data.ofertaAlineacion;
        this.nombreAlineacion = data.nombreAlineacion;
        this.vencimientoAlineacion = data.vencimientoAlineacion;
        this.precioAlineacion = data.precioAlineacion;
        this.precioColor = data.precioColor;
      }
  }
}
