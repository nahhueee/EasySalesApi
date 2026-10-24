import db from '../db';
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

// ─── Fase 3.2-D: consultas del visor de eventos (solo lectura) ──────────────────────────────
// Consultar no es una mutación: no genera evento propio.

export interface FiltroEventos {
    desde?: string;          // 'YYYY-MM-DD' (inclusive)
    hasta?: string;          // 'YYYY-MM-DD' (inclusive)
    idUsuario?: number;
    idPuesto?: string;
    entidad?: string;
    acciones?: string[];
    entidadId?: number;
    texto?: string;
    pagina: number;
    tamanioPagina: number;
}

const COLUMNAS_VISOR =
    ` e.id, e.fecha, e.idUsuario, u.nombre AS usuarioNombre, (u.fechaBaja IS NOT NULL) AS usuarioDeBaja,
      e.idPuesto, COALESCE(p.nombre, p.hostname) AS puestoNombre,
      e.accion, e.entidad, e.entidadId, e.descripcion, e.datosAntes, e.datosDespues `;

const JOINS_VISOR =
    ` FROM eventos e
      LEFT JOIN usuarios u ON u.id = e.idUsuario
      LEFT JOIN puestos p ON p.id = e.idPuesto `;

// mysql2 devuelve las columnas JSON ya parseadas (MySQL 8); si llegaran como string se parsean acá,
// así el front siempre recibe objetos.
function aObjeto(valor: any): object | null {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'string') {
        try { return JSON.parse(valor); } catch { return null; }
    }
    return valor;
}

function mapearFila(r: any) {
    return {
        id: Number(r.id),
        fecha: r.fecha,
        idUsuario: r.idUsuario ?? null,
        usuarioNombre: r.usuarioNombre ?? null,
        usuarioDeBaja: !!r.usuarioDeBaja,
        idPuesto: r.idPuesto ?? null,
        puestoNombre: r.puestoNombre ?? null,
        accion: r.accion,
        entidad: r.entidad,
        entidadId: r.entidadId ?? null,
        descripcion: r.descripcion ?? null,
        datosAntes: aObjeto(r.datosAntes),
        datosDespues: aObjeto(r.datosDespues),
    };
}

const ID_EN = (col: string, campo: string) =>
    `CAST(JSON_UNQUOTE(JSON_EXTRACT(${col}, '$.${campo}')) AS UNSIGNED)`;

class EventosConsultasRepository {

    async Obtener(f: FiltroEventos) {
        const connection = await db.getConnection();
        try {
            const where: string[] = [];
            const params: any[] = [];

            // Sin fechas: últimos 7 días (hoy + 6 anteriores). El resto del rango lo resuelve la ruta.
            if (f.desde) { where.push('e.fecha >= ?'); params.push(f.desde); }
            else         { where.push('e.fecha >= CURDATE() - INTERVAL 6 DAY'); }
            if (f.hasta) { where.push('e.fecha < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(f.hasta); }

            if (f.idUsuario != null)  { where.push('e.idUsuario = ?');  params.push(f.idUsuario); }
            if (f.idPuesto)           { where.push('e.idPuesto = ?');   params.push(f.idPuesto); }
            if (f.entidad)            { where.push('e.entidad = ?');    params.push(f.entidad); }
            if (f.entidadId != null)  { where.push('e.entidadId = ?');  params.push(f.entidadId); }
            if (f.acciones && f.acciones.length > 0) {
                where.push(`e.accion IN (${f.acciones.map(() => '?').join(',')})`);
                params.push(...f.acciones);
            }
            if (f.texto) {
                // Carácter de escape '!' (evita el manejo de backslash de MySQL): el texto se busca literal.
                where.push("e.descripcion LIKE ? ESCAPE '!'");
                params.push('%' + f.texto.replace(/[!%_]/g, '!$&') + '%');
            }

            const whereSql = ' WHERE ' + where.join(' AND ');

            // Los filtros solo tocan columnas de eventos: el total no necesita los JOIN.
            const [totalRows] = await connection.query<any[]>(
                `SELECT COUNT(*) AS total FROM eventos e ${whereSql}`, params);

            const [rows] = await connection.query<any[]>(
                `SELECT ${COLUMNAS_VISOR} ${JOINS_VISOR} ${whereSql}
                 ORDER BY e.fecha DESC, e.id DESC
                 LIMIT ? OFFSET ?`,
                [...params, f.tamanioPagina, (f.pagina - 1) * f.tamanioPagina]);

            return { total: Number(totalRows[0].total), registros: rows.map(mapearFila) };

        } finally {
            connection.release();
        }
    }

    /**
     * Historia completa de una entidad, en orden cronológico. Además de los eventos propios suma los
     * relacionados que se guardan bajo otra entidad (ver 3.2-B): las notas de crédito de una venta
     * (datosDespues.idVenta) y los movimientos de una caja (idCaja en datos, o movimientos creados en
     * esa caja, para alcanzar la anulación, que no guarda idCaja).
     */
    async ObtenerPorEntidad(entidad: string, id: number) {
        const connection = await db.getConnection();
        try {
            let condicion = '(e.entidad = ? AND e.entidadId = ?)';
            const params: any[] = [entidad, id];

            if (entidad === 'ventas') {
                condicion += ` OR (e.entidad = 'notas_credito' AND ${ID_EN('e.datosDespues', 'idVenta')} = ?)`;
                params.push(id);
            } else if (entidad === 'cajas') {
                condicion += ` OR (e.entidad = 'cajas_movimientos' AND (
                                    ${ID_EN('e.datosDespues', 'idCaja')} = ?
                                    OR ${ID_EN('e.datosAntes', 'idCaja')} = ?
                                    OR e.entidadId IN (
                                        SELECT m.entidadId FROM eventos m
                                        WHERE m.entidad = 'cajas_movimientos' AND m.accion = 'CAJA_MOVIMIENTO_CREAR'
                                          AND ${ID_EN('m.datosDespues', 'idCaja')} = ?)))`;
                params.push(id, id, id);
            }

            const [rows] = await connection.query<any[]>(
                `SELECT ${COLUMNAS_VISOR} ${JOINS_VISOR}
                 WHERE ${condicion}
                 ORDER BY e.fecha ASC, e.id ASC
                 LIMIT 500`,
                params);

            return rows.map(mapearFila);

        } finally {
            connection.release();
        }
    }

    /** Usuarios (incluidos los de baja) y puestos que aparecen en eventos, para llenar los selects. */
    async ObtenerFiltros() {
        const connection = await db.getConnection();
        try {
            const [usuarios] = await connection.query<any[]>(
                `SELECT x.idUsuario AS id, u.nombre, (u.fechaBaja IS NOT NULL) AS deBaja
                 FROM (SELECT DISTINCT idUsuario FROM eventos WHERE idUsuario IS NOT NULL) x
                 LEFT JOIN usuarios u ON u.id = x.idUsuario
                 ORDER BY (u.fechaBaja IS NOT NULL), u.nombre`);

            const [puestos] = await connection.query<any[]>(
                `SELECT x.idPuesto AS id, COALESCE(p.nombre, p.hostname) AS nombre
                 FROM (SELECT DISTINCT idPuesto FROM eventos WHERE idPuesto IS NOT NULL) x
                 LEFT JOIN puestos p ON p.id = x.idPuesto
                 ORDER BY nombre`);

            return {
                usuarios: usuarios.map(u => ({ id: Number(u.id), nombre: u.nombre ?? null, deBaja: !!u.deBaja })),
                puestos:  puestos.map(p => ({ id: p.id, nombre: p.nombre ?? null })),
            };

        } finally {
            connection.release();
        }
    }
}

export const EventosConsultas = new EventosConsultasRepository();
