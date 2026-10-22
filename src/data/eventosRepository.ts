import { Evento } from '../models/Evento';

// Fase 3.2-B (ver documentos/handoff_fase3_2b_eventos.md). Auditoría estructurada de los
// flujos de plata.
//
// Reglas (architecture.md §11.5, §11.6):
// - Se registra SIEMPRE con la conexión de la operación, dentro de su transacción: si la
//   operación hace rollback, el evento también. Por eso `connection` es obligatoria.
// - No captura errores: si el INSERT falla, el error sube y el caller hace rollback. No existe
//   operación de plata sin su registro de auditoría.
// - La hora la pone MySQL (DEFAULT CURRENT_TIMESTAMP); acá nunca se manda `fecha`.

const DESCRIPCION_MAX = 255;
const JSON_MAX_BYTES = 16 * 1024;

// Red de seguridad: los snapshots tienen que ser chicos (solo ids, montos y estados).
function serializar(datos: object | null | undefined): string | null {
    if (datos === null || datos === undefined) return null;
    const texto = JSON.stringify(datos);
    const bytes = Buffer.byteLength(texto, 'utf8');
    return bytes > JSON_MAX_BYTES ? JSON.stringify({ truncado: true, bytes }) : texto;
}

class EventosRepository {

    async Registrar(connection: any, evento: Evento): Promise<void> {
        if (!connection) {
            throw new Error('EventosRepo.Registrar requiere la conexión de la transacción de la operación.');
        }

        const descripcion = evento.descripcion
            ? String(evento.descripcion).slice(0, DESCRIPCION_MAX)
            : null;

        await connection.query(
            `INSERT INTO eventos (idPuesto, idUsuario, accion, entidad, entidadId, datosAntes, datosDespues, descripcion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                evento.auditoria?.puestoId ?? null,
                evento.auditoria?.usuarioId ?? null,
                evento.accion,
                evento.entidad,
                evento.entidadId ?? null,
                serializar(evento.datosAntes),
                serializar(evento.datosDespues),
                descripcion,
            ]
        );
    }
}

export const EventosRepo = new EventosRepository();
