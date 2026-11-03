// Fase 3.4-A (A1): deadlock de InnoDB (error 1213) -> mensaje para el usuario.
// Orden global de locks en architecture.md §11.2: caja -> cliente/proveedor -> productos (id ascendente).
// Si igual salta un 1213 (gap locks, etc.) se informa como conflicto 409; la operación es segura de
// reintentar a mano (la venta, además, por su idempotencyKey). Sin reintento automático.
export const MENSAJE_CONCURRENCIA = 'La operación chocó con otra al mismo tiempo. Intentá de nuevo.';

export function esDeadlock(error: any): boolean {
    return error?.errno === 1213 || error?.code === 'ER_LOCK_DEADLOCK';
}
