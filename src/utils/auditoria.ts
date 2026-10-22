import { Request } from 'express';
import { esUuidV4, puestoIdDeRequest } from './puestos';
import { Auditoria } from '../models/Evento';

// Lote 6 + PR 1, Fase 2 (auditoría real, ver documentos/handoff_fase2_correcciones.md y
// documentos/handoff_pr1_identidad_puesto.md): extrae usuario_id / puesto_id del request para
// pasarlos explícitos hasta SesionServ.RegistrarMovimiento(), en vez de leerlos de session.json
// (global, compartido entre puestos en LAN).
//
// Vocabulario (no reabrir, ver architecture.md §1.2, §9.2, §18.5):
// - terminal: la instalación completa (unidad de licencia, la que conoce AdminServer).
//   Vive en terminal.json, solo en la PC servidora. No sirve para auditoría por máquina.
// - puesto: una máquina física que ejecuta el front. Unidad de auditoría. UUID generado
//   y persistido por el lado Rust (obtener_puesto_id en src-tauri/src/main.rs).
//
// El front los manda como headers (ApiService los agrega a toda request autenticada,
// leyendo usuario_id de localStorage y puesto_id del comando Tauri obtener_puesto_id).
// Devuelve null si faltan — SesionServ cae al fallback de session.json en ese caso, no rompe.
export function datosAuditoria(req: Request): { usuarioId: string | null, puestoId: string | null } {
    const usuarioId = req.header('x-usuario-id') || null;
    // puestoId se valida (UUID v4): un header basura o más largo que usuarios_movimientos.idPuesto
    // (varchar 36) haría fallar el INSERT del log legacy y, en los flujos con transacción, la
    // operación entera. Inválido o ausente => null.
    const puestoId = puestoIdDeRequest(req);
    return { usuarioId, puestoId };
}

// Fase 3.2-B (tabla `eventos`): normaliza usuario y puesto a lo que la tabla acepta.
// - usuarioId: entero positivo; cualquier otra cosa => null.
// - puestoId: UUID v4 válido; cualquier otra cosa => null.
// NUNCA se completa con session.json: un "no se sabe" honesto es mejor que atribuirle la
// operación a otra persona en una LAN. datosAuditoria() queda como está porque SesionServ
// (log legacy usuarios_movimientos) todavía lo usa.
/** Identidad desconocida: se registra como NULL, nunca con session.json. */
export const SIN_AUDITORIA: Auditoria = { usuarioId: null, puestoId: null };

export function auditoriaDesde(usuarioId?: number | string | null, puestoId?: string | null): Auditoria {
    const n = Number(usuarioId);
    return {
        usuarioId: usuarioId != null && Number.isInteger(n) && n > 0 ? n : null,
        puestoId: esUuidV4(puestoId) ? puestoId.toLowerCase() : null,
    };
}

/** Para las rutas que todavía no pasan identidad al repositorio. */
export function auditoriaDesdeRequest(req: Request): Auditoria {
    const { usuarioId, puestoId } = datosAuditoria(req);
    return auditoriaDesde(usuarioId, puestoId);
}
