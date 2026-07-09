import moment from "moment";
import db from '../db';

export interface NotaCreditoDetalleInput {
    idVentaDetalle: number; // ventas_detalle.id (linea exacta acreditada)
    idProducto: number;
    nomProd: string;
    cantidad: number;
    precio: number;
}

export interface NotaCreditoInput {
    idVenta: number;
    tipo: number; // TipoComprobante (objFacturar.ts): NC_A=3 / NC_B=8 / NC_C=13
    cae: string | number;
    caeVto: any; // moment | Date | string
    ticket: number;
    ptoVenta: number;
    neto: number;
    iva: number;
    total: number;
    esParcial: boolean;
    fecha: Date;
    motivo?: string | null;
}

// Fila tal como se lee de `notas_credito` — usada por el read-path
// (NotaCreditoService.ObtenerImpresion) para reconstruir el comprobante sin volver a
// pasar por AFIP, ya sea justo después de emitir o al reimprimir una NC vieja.
export interface NotaCreditoRow {
    id: number;
    idVenta: number;
    tipo: number;
    cae: string;
    caeVto: Date;
    ticket: number;
    ptoVenta: number;
    neto: number;
    iva: number;
    total: number;
    esParcial: boolean;
    fecha: Date;
    motivo: string | null;
}

class NotasCreditoRepository {

    async InsertarNotaCredito(connection, nc: NotaCreditoInput): Promise<number> {
        try {
            const consulta = " INSERT INTO notas_credito(idVenta, tipo, cae, caeVto, ticket, ptoVenta, neto, iva, total, esParcial, fecha, motivo) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ";

            const parametros = [
                nc.idVenta, nc.tipo, nc.cae, moment(nc.caeVto).format('YYYY-MM-DD'),
                nc.ticket, nc.ptoVenta, nc.neto, nc.iva, nc.total, nc.esParcial,
                moment(nc.fecha).format('YYYY-MM-DD HH:mm:ss'), nc.motivo ?? null
            ];

            const [resultado] = await connection.query(consulta, parametros);
            return (resultado as any).insertId;

        } catch (error) {
            throw error;
        }
    }

    async InsertarDetalle(connection, idNotaCredito: number, detalle: NotaCreditoDetalleInput): Promise<void> {
        try {
            const consulta = " INSERT INTO notas_credito_detalle(idNotaCredito, idVentaDetalle, idProducto, nomProd, cantidad, precio) " +
                             " VALUES(?, ?, ?, ?, ?, ?) ";

            const parametros = [idNotaCredito, detalle.idVentaDetalle, detalle.idProducto, detalle.nomProd, detalle.cantidad, detalle.precio];
            await connection.query(consulta, parametros);

        } catch (error) {
            throw error;
        }
    }

    // Total ya acreditado contra esta venta (NCs previas, totales o parciales). Usado para:
    // - decidir en el frontend si se muestra "Emitir NC" o "Eliminar" (ventasRepository.ObtenerQuery)
    // - validar que una nueva NC no exceda lo que falta por acreditar
    async ObtenerAcreditadoVenta(connection, idVenta: number): Promise<number> {
        try {
            const [rows] = await connection.query(
                " SELECT COALESCE(SUM(total), 0) AS acreditado FROM notas_credito WHERE idVenta = ? ",
                [idVenta]
            );
            // mysql2 devuelve el SUM() de un DECIMAL como string, no number
            return Number((rows as any)[0].acreditado ?? 0);

        } catch (error) {
            throw error;
        }
    }

    // Cantidad ya acreditada por linea de venta (idVentaDetalle), para validar sobre-acreditacion
    // en NC parcial: acreditado + nuevo <= vendido, por producto/linea.
    async ObtenerAcreditadoPorLinea(connection, idVenta: number): Promise<Record<number, number>> {
        try {
            const [rows] = await connection.query(
                " SELECT ncd.idVentaDetalle, COALESCE(SUM(ncd.cantidad), 0) AS cantidadAcreditada " +
                " FROM notas_credito_detalle ncd " +
                " INNER JOIN notas_credito nc ON nc.id = ncd.idNotaCredito " +
                " WHERE nc.idVenta = ? " +
                " GROUP BY ncd.idVentaDetalle ",
                [idVenta]
            );

            const acreditadoPorLinea: Record<number, number> = {};
            for (const row of rows as any[]) {
                acreditadoPorLinea[row.idVentaDetalle] = Number(row.cantidadAcreditada ?? 0);
            }
            return acreditadoPorLinea;

        } catch (error) {
            throw error;
        }
    }

    // Lee una NC por id. Read-path para reimprimir/reconstruir el comprobante sin
    // volver a emitir en AFIP (ver NotaCreditoService.ObtenerImpresion).
    async ObtenerPorId(connection, idNotaCredito: number): Promise<NotaCreditoRow | null> {
        try {
            const [rows] = await connection.query(
                " SELECT id, idVenta, tipo, cae, caeVto, ticket, ptoVenta, neto, iva, total, esParcial, fecha, motivo " +
                " FROM notas_credito WHERE id = ? ",
                [idNotaCredito]
            );

            const row = (rows as any[])[0];
            if (!row) return null;

            return {
                id:        row.id,
                idVenta:   row.idVenta,
                tipo:      row.tipo,
                cae:       row.cae,
                caeVto:    row.caeVto,
                ticket:    row.ticket,
                ptoVenta:  row.ptoVenta,
                neto:      Number(row.neto),
                iva:       Number(row.iva),
                total:     Number(row.total),
                esParcial: !!row.esParcial,
                fecha:     row.fecha,
                motivo:    row.motivo,
            };

        } catch (error) {
            throw error;
        }
    }

    // Lista de NCs emitidas para una venta, orden de emisión (ASC) — alimenta el submenú
    // Ver/Imprimir Comprobante (NC 1, NC 2, ...) para ver/reimprimir comprobantes ya emitidos.
    async ObtenerPorVenta(connection, idVenta: number): Promise<NotaCreditoRow[]> {
        try {
            const [rows] = await connection.query(
                " SELECT id, idVenta, tipo, cae, caeVto, ticket, ptoVenta, neto, iva, total, esParcial, fecha, motivo " +
                " FROM notas_credito WHERE idVenta = ? ORDER BY fecha ASC ",
                [idVenta]
            );

            return (rows as any[]).map(row => ({
                id:        row.id,
                idVenta:   row.idVenta,
                tipo:      row.tipo,
                cae:       row.cae,
                caeVto:    row.caeVto,
                ticket:    row.ticket,
                ptoVenta:  row.ptoVenta,
                neto:      Number(row.neto),
                iva:       Number(row.iva),
                total:     Number(row.total),
                esParcial: !!row.esParcial,
                fecha:     row.fecha,
                motivo:    row.motivo,
            }));

        } catch (error) {
            throw error;
        }
    }

    // Resumen de NCs emitidas para todas las ventas de una caja — alimenta la pestaña
    // "Notas de Crédito" del resumen de caja (informativo: cuánto quedó como saldo a favor).
    async ObtenerResumenPorCaja(idCaja: number): Promise<{ cantidad: number; total: number }> {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                " SELECT COUNT(*) AS cantidad, COALESCE(SUM(nc.total), 0) AS total " +
                " FROM notas_credito nc " +
                " INNER JOIN ventas v ON v.id = nc.idVenta " +
                " WHERE v.idCaja = ? AND v.fechaBaja IS NULL ",
                [idCaja]
            );
            const row = (rows as any)[0];
            return {
                cantidad: Number(row.cantidad ?? 0),
                total:    Number(row.total    ?? 0),
            };
        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Detalle de una NC parcial (vacío si la NC es total). Mismo uso que ObtenerPorId.
    async ObtenerDetallePorNota(connection, idNotaCredito: number): Promise<NotaCreditoDetalleInput[]> {
        try {
            const [rows] = await connection.query(
                " SELECT idVentaDetalle, idProducto, nomProd, cantidad, precio " +
                " FROM notas_credito_detalle WHERE idNotaCredito = ? ",
                [idNotaCredito]
            );

            return (rows as any[]).map(row => ({
                idVentaDetalle: row.idVentaDetalle,
                idProducto:     row.idProducto,
                nomProd:        row.nomProd,
                cantidad:       Number(row.cantidad),
                precio:         Number(row.precio),
            }));

        } catch (error) {
            throw error;
        }
    }
}

export const NotasCreditoRepo = new NotasCreditoRepository();
