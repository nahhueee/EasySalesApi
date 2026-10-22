// Fase 3.2-B (ver documentos/handoff_fase3_2b_eventos.md): modelo de la tabla `eventos`.

export type AccionEvento =
    | 'VENTA_CREAR' | 'VENTA_ANULAR' | 'VENTA_FACTURAR'
    | 'NC_EMITIR'
    | 'CAJA_ABRIR' | 'CAJA_MODIFICAR' | 'CAJA_CERRAR' | 'CAJA_REABRIR' | 'CAJA_ELIMINAR'
    | 'CAJA_MOVIMIENTO_CREAR' | 'CAJA_MOVIMIENTO_ANULAR' | 'CAJA_MOVIMIENTO_ELIMINAR'
    | 'CC_COBRO' | 'CC_COBRO_REVERTIR'
    | 'CC_VENTA_PAGADA' | 'CC_VENTA_PAGO_REVERTIR'
    | 'CC_AJUSTE'
    | 'PROVEEDOR_PAGO' | 'PROVEEDOR_PAGO_ANULAR'
    | 'PROVEEDOR_FACTURA' | 'PROVEEDOR_FACTURA_ANULAR'
    | 'PROVEEDOR_AJUSTE';

export type EntidadEvento =
    | 'ventas' | 'notas_credito' | 'cajas' | 'cajas_movimientos'
    | 'cuenta_corriente' | 'proveedores';

/** Quién y desde dónde. null = "no se sabe" (nunca se completa con session.json). */
export interface Auditoria {
    usuarioId: number | null;
    puestoId: string | null;
}

export interface Evento {
    accion: AccionEvento;
    entidad: EntidadEvento;
    entidadId?: number | null;
    datosAntes?: object | null;
    datosDespues?: object | null;
    descripcion?: string | null;
    auditoria: Auditoria;
}
