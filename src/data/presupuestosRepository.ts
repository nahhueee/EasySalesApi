import db from '../db';
import { Presupuesto } from '../models/Presupuesto';
import { DetallePresupuesto } from '../models/DetallePresupuesto';
import { Cliente } from '../models/Cliente';
import { Producto } from '../models/Producto';
import { ResultSetHeader } from 'mysql2';
const moment = require('moment');

class PresupuestosRepository {

    //#region AGREGAR
    async Agregar(presupuesto: Presupuesto): Promise<number> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const diasValidez = presupuesto.validezDias ?? 7;
            const validezHasta = moment().add(diasValidez, 'days').format('YYYY-MM-DD');

            const [result] = await connection.query<ResultSetHeader>(
                `INSERT INTO presupuestos (idCliente, idUsuario, idCaja, fecha, validezHasta, total, estado)
                 VALUES (?, ?, ?, CURDATE(), ?, ?, 'vigente')`,
                [
                    presupuesto.idCliente,
                    presupuesto.idUsuario,
                    presupuesto.idCaja ?? null,
                    validezHasta,
                    presupuesto.total,
                ]
            );

            const idPresupuesto: number = result.insertId;

            for (const detalle of presupuesto.detalles) {
                await connection.query(
                    `INSERT INTO presupuestos_detalle (idPresupuesto, idProducto, nomProd, cantidad, precio, costo, total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        idPresupuesto,
                        detalle.idProducto,
                        detalle.nomProd,
                        detalle.cantidad,
                        detalle.precio,
                        detalle.costo,
                        detalle.total,
                    ]
                );
            }

            await connection.commit();
            return idPresupuesto;

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region OBTENER
    async Obtener(filtros: any) {
        const connection = await db.getConnection();

        try {
            // Lazy: marcar como vencidos los que superaron su validez
            await connection.query(
                `UPDATE presupuestos SET estado = 'vencido'
                 WHERE estado = 'vigente' AND validezHasta < CURDATE()`
            );

            let filtro = '';
            const params: any[] = [];

            if (filtros.idCaja) {
                filtro += ' AND p.idCaja = ?';
                params.push(filtros.idCaja);
            }
            if (filtros.idCliente) {
                filtro += ' AND p.idCliente = ?';
                params.push(filtros.idCliente);
            }
            if (filtros.estado) {
                filtro += ' AND p.estado = ?';
                params.push(filtros.estado);
            }

            const limit  = filtros.tamanioPagina ?? 20;
            const offset = ((filtros.pagina ?? 1) - 1) * limit;

            const queryRegistros = `
                SELECT p.*, COALESCE(c.nombre, 'ELIMINADO') AS cliente
                FROM presupuestos p
                LEFT JOIN clientes c ON c.id = p.idCliente
                WHERE 1 = 1 ${filtro}
                ORDER BY p.id DESC
                LIMIT ? OFFSET ?
            `;

            const queryTotal = `
                SELECT COUNT(*) AS total
                FROM presupuestos p
                WHERE 1 = 1 ${filtro}
            `;

            const [rows]        = await connection.query(queryRegistros, [...params, limit, offset]);
            const [totalResult] = await connection.query(queryTotal, params);

            const presupuestos: Presupuesto[] = [];

            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const p       = new Presupuesto();
                    p.id          = row['id'];
                    p.idCliente   = row['idCliente'];
                    p.idUsuario   = row['idUsuario'];
                    p.idCaja      = row['idCaja'];
                    p.fecha       = row['fecha'];
                    p.validezHasta = row['validezHasta'];
                    p.total       = parseFloat(row['total']);
                    p.estado      = row['estado'];
                    p.idVentaGenerada = row['idVentaGenerada'];
                    p.cliente     = new Cliente({ id: row['idCliente'], nombre: row['cliente'] });
                    presupuestos.push(p);
                }
            }

            return { total: totalResult[0].total, registros: presupuestos };

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerDetalle(id: number): Promise<DetallePresupuesto[]> {
        const connection = await db.getConnection();

        try {
            const consulta = `
                SELECT pd.*,
                       COALESCE(p.nombre, 'ELIMINADO') AS producto,
                       p.soloPrecio,
                       p.codigo,
                       p.unidad
                FROM presupuestos_detalle pd
                LEFT JOIN productos p ON p.id = pd.idProducto
                WHERE pd.idPresupuesto = ?
                ORDER BY pd.id ASC
            `;

            const [rows] = await connection.query(consulta, [id]);
            const detalles: DetallePresupuesto[] = [];

            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const d        = new DetallePresupuesto();
                    d.id           = row['id'];
                    d.idPresupuesto = row['idPresupuesto'];
                    d.idProducto   = row['idProducto'];
                    d.nomProd      = row['nomProd'];
                    d.cantidad     = parseFloat(row['cantidad']);
                    d.precio       = parseFloat(row['precio']);
                    d.costo        = parseFloat(row['costo']);
                    d.total        = parseFloat(row['total']);
                    d.producto     = new Producto({
                        id:         row['idProducto'],
                        nombre:     row['producto'],
                        codigo:     row['codigo'],
                        unidad:     row['unidad'],
                        soloPrecio: row['soloPrecio'] == 1,
                        precio:     parseFloat(row['precio']),
                        costo:      parseFloat(row['costo']),
                    });
                    detalles.push(d);
                }
            }

            return detalles;

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion

    //#region ANULAR
    async Anular(id: number): Promise<void> {
        const connection = await db.getConnection();

        try {
            // Solo se pueden anular presupuestos vigentes o vencidos
            await connection.query(
                `UPDATE presupuestos SET estado = 'anulado'
                 WHERE id = ? AND estado IN ('vigente', 'vencido')`,
                [id]
            );
        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }
    //#endregion
}

export const PresupuestosRepo = new PresupuestosRepository();
