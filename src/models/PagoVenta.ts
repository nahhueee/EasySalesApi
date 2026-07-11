export class pagoVenta {
    idVenta?: number;
    monto?: number;
    entrega?: number;
    restante?: number;
    recargo: number = 0;
    descuento: number = 0;
    tipoModificador?: 'porcentaje' | 'monto';
    realizado?: boolean;
    /** Monto entregado por el cliente en efectivo (para calcular vuelto). Solo EFECTIVO. */
    pagaCon?: number;

    constructor(data?: any) {
        if (data) {
          this.entrega = data.entrega;
          this.restante = data.restante;
          this.monto = data.monto;
          this.descuento = data.descuento;
          this.recargo = data.recargo;
          this.tipoModificador = data.tipoModificador;
          this.realizado = (data.realizado==1) ? true : false;
          this.pagaCon = data.pagaCon ?? null;
        }
    }
}