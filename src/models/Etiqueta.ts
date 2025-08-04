export class Etiqueta{
  id? : number;
  nombre? : string;
  tamanio? : string;
  mCodigo?: boolean;
  mPrecio?: boolean;
  mNombre?: boolean;
  logoEmpresa?:string;
  nombreEmpresa?: string;

  constructor(data?: any) {
        if (data) {
          this.id = data.id;
          this.nombre = data.nombre;
          this.tamanio = data.tamanio;
          this.mCodigo = data.mCodigo;
          this.mPrecio = data.mPrecio;
          this.mNombre = data.mNombre;
          this.logoEmpresa = data.logoEmpresa;
          this.nombreEmpresa = data.nombreEmpresa;
        }
    }
}
