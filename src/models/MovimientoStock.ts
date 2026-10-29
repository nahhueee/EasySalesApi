// Fase 3.3 (ver documentos/handoff_fase3_3_stock.md): catálogo de motivos de la tabla
// `productos_movimientos`. Alta de un motivo nuevo = agregarlo acá, en la etiqueta del front
// (productos-movimientos-stock) y documentarlo en architecture.md §12.4.

export type MotivoStock =
    | 'SALDO_INICIAL'      // migration de datos
    | 'ALTA'               // alta de producto con cantidad ≠ 0
    | 'VENTA'              // ventasRepository.Agregar — idReferencia = idVenta
    | 'ANULACION_VENTA'    // ventasRepository.Eliminar — idReferencia = idVenta
    | 'DEVOLUCION_NC'      // NC con reingreso — idReferencia = idNotaCredito
    | 'AJUSTE'             // edición de cantidad en el modal de producto
    | 'INGRESO';           // pantalla "agregar cantidad"

export interface MovimientoStock {
    id: number;
    idProducto: number;
    fecha: Date;
    motivo: MotivoStock;
    cantidadDelta: number;
    cantidadResultante: number;
    idReferencia: number | null;
    idUsuario: number | null;
    usuarioNombre: string | null;
    idPuesto: string | null;
    puestoNombre: string | null;
    observacion: string | null;
}
