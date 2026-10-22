import { Request } from 'express';

// Fase 3.2-A (ver documentos/handoff_fase3_2a_puestos.md): helpers compartidos por la ruta
// /easysales/puestos y el middleware puestoVisto.

// UUID v4 (el que genera obtener_puesto_id en el lado Rust).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function esUuidV4(valor: unknown): valor is string {
    return typeof valor === 'string' && UUID_V4.test(valor);
}

/** UUID del header X-Puesto-Id, o null si falta o es inválido. */
export function puestoIdDeRequest(req: Request): string | null {
    const id = req.header('x-puesto-id');
    return esUuidV4(id) ? id.toLowerCase() : null;
}

/** IP del cliente tal como la ve el socket, sin el prefijo IPv4-mapped (::ffff:). */
export function ipDeRequest(req: Request): string | null {
    const ip = req.socket?.remoteAddress;
    if (!ip) return null;
    return ip.replace(/^::ffff:/i, '').slice(0, 45);
}

/**
 * true si el request viene de la propia PC servidora (loopback). El backend siempre corre en la
 * PC servidora, así que el puesto que le habla por loopback es esa misma máquina. Lo decide el
 * backend, nunca el front.
 */
export function esLoopback(req: Request): boolean {
    const ip = req.socket?.remoteAddress;
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}
