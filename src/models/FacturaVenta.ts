export class FacturaVenta{
    idVenta? : number;
    cae?: string;
    caeVto?: Date;
    ticket? : number;
    tipoComprobante? : number;
    neto? : number;
    iva? : number;
    dni? : number;
    tipoDni? : number;
    tipoDniDesc? : string;
    ptoVenta? : number;
    condReceptor? : number;
    // Receptor congelado al momento de emitir el comprobante. Un comprobante fiscal es
    // inmutable: si se derivara de la tabla clientes, renombrar un cliente cambiaria lo que
    // imprimen sus facturas viejas. NULL en facturas previas a la migracion 20260728100000,
    // donde comprobanteService cae al fallback venta.cliente.
    receptorNombre? : string;
    receptorDireccion? : string;
    // Suma de notas_credito.total ya emitidas contra esta factura (ver ventasRepository.ObtenerQuery).
    acreditado? : number;

    constructor(data?: any) {
      if (data) {
        this.idVenta = data.idVenta;
        this.cae = data.cae;
        this.caeVto = data.caeVto;
        this.ticket = data.ticket;
        this.tipoComprobante = data.tipoComprobante;
        this.neto = data.neto;
        this.iva = data.iva;
        this.dni = data.dni;
        this.tipoDni = data.tipoDni;
        this.ptoVenta = data.ptoVenta;
        this.condReceptor = data.condReceptor;
        this.receptorNombre = data.receptorNombre;
        this.receptorDireccion = data.receptorDireccion;
        this.acreditado = data.acreditado;
      }
    }
}
  
  