import { TipoPago } from "./TipoPago";

export class DetallePago{
    idVenta? : number;
    tipoPago : TipoPago = new TipoPago();
    monto : number = 0;
    
    constructor(data?: any) {
      if (data) {
        this.idVenta = data.idVenta;
        this.tipoPago = data.tipoPago;
        this.monto = data.monto;
      }
    }
  }