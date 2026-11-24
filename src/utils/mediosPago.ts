// Medios de pago "de sistema": no son un medio real de cobro, tienen significado propio en el flujo de venta.
// Hoy se identifican por nombre (deuda preexistente: CC y SAF también; a futuro conviene un flag
// tipos_pago.sistema, ver handoff_pedidos.md §9). Centralizado acá para no repetir el literal.

export const MEDIO_EFECTIVO = 'EFECTIVO';
export const MEDIO_CC = 'CUENTA CORRIENTE';
export const MEDIO_SAF = 'SALDO A FAVOR';
// Seña de un pedido ya cobrada, aplicada en la venta de entrega. Si la Ñ diera problemas en una base latin1,
// cambiar acá (y en la migration 20261123120100) por 'SENIA' y mostrar "Seña" en la UI.
export const MEDIO_SENIA = 'SEÑA';

export function esMedio(nombre: string | undefined | null, medio: string): boolean {
    return (nombre ?? '').toUpperCase() === medio;
}

// Medios que no se pueden usar para cobrar una seña: no son plata recibida en el momento.
export const MEDIOS_NO_VALIDOS_PARA_SENIA = [MEDIO_CC, MEDIO_SAF, MEDIO_SENIA];
