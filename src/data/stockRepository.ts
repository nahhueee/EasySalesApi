import db from '../db';
import { Auditoria } from '../models/Evento';
import { MotivoStock, MovimientoStock } from '../models/MovimientoStock';
import { auditoriaDesde } from '../utils/auditoria';

// Fase 3.3 (ver documentos/handoff_fase3_3_stock.md y architecture.md §12.4).
//
// REGLA: toda modificación de `productos.cantidad` pasa por StockRepo.Mover. Nadie más escribe
// esa columna con un UPDATE directo (excepción única: el INSERT de un producto nuevo, que va
// con cantidad = 0 y después mueve su cantidad inicial con el motivo ALTA). Aplica también a
// features futuras (Pedidos, compras).
//
// - La conexión es obligatoria y es la de la transacción del caller: si la operación hace
//   rollback, el movimiento y el cambio de stock también. No captura errores.
// - Versión liviana: nunca bloquea por stock insuficiente o negativo.
// - La fecha la pone MySQL (DEFAULT CURRENT_TIMESTAMP).

const OBSERVACION_MAX = 255;
const TAMANIO_PAGINA_MAX = 100;

const redondear3 = (n: number): number => Math.round((n + Number.EPSILON) * 1000) / 1000;

export interface MoverStock {
    idProducto: number;
    delta: number;                       // + entra, - sale
    motivo: MotivoStock;
    idReferencia?: number | null;
    observacion?: string | null;
    auditoria: Auditoria;
}

class StockRepository {

    /**
     * Suma `delta` al stock del producto y deja el movimiento en el historial.
     * `aplicado: false` (sin error) cuando el producto no maneja stock o no existe:
     * un huérfano nunca rompe la operación de negocio que lo está moviendo.
     */
    async Mover(connection: any, mov: MoverStock): Promise<{ aplicado: boolean, cantidadResultante?: number }> {
        if (!connection) {
            throw new Error('StockRepo.Mover requiere la conexión de la transacción de la operación.');
        }

        const delta = Number(mov.delta);
        if (!Number.isFinite(delta)) {
            throw new Error(`StockRepo.Mover: delta inválido (${mov.delta}) para el producto ${mov.idProducto}.`);
        }

        const [rows] = await connection.query(
            'SELECT cantidad, soloPrecio, codigo FROM productos WHERE id = ? FOR UPDATE',
            [mov.idProducto]
        );
        const producto = (rows as any[])[0];

        if (!producto) return { aplicado: false };                                   // huérfano
        // VARIOS se identifica por código de negocio, no por id (§12.7).
        if (producto.soloPrecio || producto.codigo === '*') return { aplicado: false };
        if (redondear3(delta) === 0) return { aplicado: false };

        const anterior = Number(producto.cantidad ?? 0);
        const cantidadResultante = redondear3(anterior + delta);
        const auditoria = auditoriaDesde(mov.auditoria?.usuarioId, mov.auditoria?.puestoId);

        await connection.query(
            'UPDATE productos SET cantidad = cantidad + ? WHERE id = ?',
            [redondear3(delta), mov.idProducto]
        );

        await connection.query(
            `INSERT INTO productos_movimientos
                (idProducto, motivo, cantidadDelta, cantidadResultante, idReferencia, idUsuario, idPuesto, observacion)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                mov.idProducto,
                mov.motivo,
                redondear3(delta),
                cantidadResultante,
                mov.idReferencia ?? null,
                auditoria.usuarioId,
                auditoria.puestoId,
                mov.observacion ? String(mov.observacion).slice(0, OBSERVACION_MAX) : null,
            ]
        );

        return { aplicado: true, cantidadResultante };
    }

    /** Historial de stock de un producto, más reciente primero. Solo lectura (no genera evento). */
    async ObtenerPorProducto(idProducto: number, pagina: number, tamanioPagina: number)
        : Promise<{ registros: MovimientoStock[], total: number }> {
        const tamanio = Math.min(Math.max(Math.floor(tamanioPagina) || 20, 1), TAMANIO_PAGINA_MAX);
        const offset = (Math.max(Math.floor(pagina) || 1, 1) - 1) * tamanio;

        const connection = await db.getConnection();
        try {
            const [totalRows] = await connection.query<any[]>(
                'SELECT COUNT(*) AS total FROM productos_movimientos WHERE idProducto = ?', [idProducto]
            );

            const [rows] = await connection.query<any[]>(
                `SELECT pm.id, pm.idProducto, pm.fecha, pm.motivo, pm.cantidadDelta, pm.cantidadResultante,
                        pm.idReferencia, pm.idUsuario, u.nombre AS usuarioNombre,
                        pm.idPuesto, COALESCE(pu.nombre, pu.hostname) AS puestoNombre, pm.observacion
                 FROM productos_movimientos pm
                 LEFT JOIN usuarios u ON u.id = pm.idUsuario
                 LEFT JOIN puestos pu ON pu.id = pm.idPuesto
                 WHERE pm.idProducto = ?
                 ORDER BY pm.fecha DESC, pm.id DESC
                 LIMIT ? OFFSET ?`,
                [idProducto, tamanio, offset]
            );

            const registros = rows.map(r => ({
                ...r,
                cantidadDelta: Number(r.cantidadDelta),
                cantidadResultante: Number(r.cantidadResultante),
            }));
            return { registros, total: Number(totalRows[0]?.total ?? 0) };
        } finally {
            connection.release();
        }
    }
}

export const StockRepo = new StockRepository();
