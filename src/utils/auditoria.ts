import { Request } from 'express';

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
    const puestoId = req.header('x-puesto-id') || null;
    // TEMP — sacar tras diagnosticar PR 1
    console.log('[Auditoría/DEBUG]', req.method, req.originalUrl, '→', { usuarioId, puestoId });
    return { usuarioId, puestoId };
}
