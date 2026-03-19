export class ObjFacturar {
    total?:number;
    tipoComprobante?: TipoComprobante;    
    docNro?:number;
    docTipo?:number;
    condReceptor?:number;

    // SOLO para Notas
    comprobanteAsociado?: {
        tipo: TipoComprobante;
        puntoVenta: number;
        numero: number;
    };
}

export enum TipoComprobante {
  FACTURA_A = 1,
  ND_A = 2,
  NC_A = 3,

  FACTURA_B = 6,
  ND_B = 7,
  NC_B = 8,

  FACTURA_C = 11,
  ND_C = 12,
  NC_C = 13
}