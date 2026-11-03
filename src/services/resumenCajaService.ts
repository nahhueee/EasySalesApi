import moment from 'moment';
import db from '../db';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { CuentasRepo } from '../data/cuentasCorsRepository';

// Fase 3.4-A: ÚNICO lugar donde se calcula una caja (ver documentos/handoff_fase3_4a_caja_backend.md §4).
// La pantalla de caja, el cierre con arqueo y la impresión leen de acá; nadie más suma ventas ni
// movimientos por su cuenta.

const MIGRATION_VENTAS_TOTAL = '20260622091000_ventas_total.js';
const MEDIO_EFECTIVO = 'EFECTIVO';
const MEDIO_CC = 'CUENTA CORRIENTE';
const MEDIO_SAF = 'SALDO A FAVOR';

// Corte de cajas históricas: el día en que cada instalación corrió la migration que rellenó
// ventas.total. Se lee una vez y se cachea. undefined = todavía no leído; null = no hay registro
// (instalación sin esa fila en knex_migrations, p.ej. migration sacada a mano): ahí no hay forma de
// saber cuáles son históricas y todas se calculan con las reglas normales.
let corteHistoricoCache: string | null | undefined;

// Condiciones reutilizadas. "Venta que cuenta" (decisión 2): sin baja, o con NC total.
const VENTA_CUENTA = `(v.fechaBaja IS NULL OR EXISTS (SELECT 1 FROM notas_credito nct WHERE nct.idVenta = v.id AND nct.esParcial = 0))`;
// Fila de pago de la venta original. Si después del backfill queda alguna en NULL, se trata como 'venta'.
const VPD_VENTA = `COALESCE(vpd.origen, 'venta') = 'venta'`;
// Origen del movimiento de caja, con la misma deducción que el backfill por si quedó alguna fila en NULL.
const MOV_ORIGEN = `COALESCE(cm.origen, CASE
        WHEN cm.idEntrega IS NOT NULL OR cm.idVentaPagoDetalle IS NOT NULL THEN 'cobro'
        WHEN cm.idProveedorMovimiento IS NOT NULL THEN 'proveedor'
        ELSE 'manual' END)`;

function r2(n: any): number {
    return Math.round((Number(n ?? 0) + Number.EPSILON) * 100) / 100;
}

async function ObtenerCorteHistorico(conn: any): Promise<string | null> {
    if (corteHistoricoCache !== undefined) return corteHistoricoCache;
    try {
        const [rows] = await conn.query(
            'SELECT migration_time FROM knex_migrations WHERE name = ? LIMIT 1', [MIGRATION_VENTAS_TOTAL]
        ) as [any[], any];
        corteHistoricoCache = rows[0]?.migration_time ? moment(rows[0].migration_time).format('YYYY-MM-DD') : null;
    } catch {
        corteHistoricoCache = null;
    }
    return corteHistoricoCache;
}

class ResumenCajaService {

    async Calcular(idCaja: number, connection?: any) {
        const externa = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            //#region Caja
            const [cajaRows] = await conn.query(
                `SELECT c.id, c.fecha, c.hora, c.inicial, c.ventas, c.finalizada, c.fondoProveedores, c.fechaBaja,
                        COALESCE(u.nombre, 'ELIMINADO') AS responsable
                 FROM cajas c LEFT JOIN usuarios u ON u.id = c.idResponsable
                 WHERE c.id = ?`, [idCaja]
            ) as [any[], any];
            const caja = cajaRows[0];
            if (!caja || caja.fechaBaja) {
                throw new AppError(CodigoError.NOT_FOUND, `La caja #${idCaja} no existe.`, 404,
                    { modulo: 'resumenCajaService.Calcular', idCaja });
            }

            const fondoAsignado: number | null = caja.fondoProveedores != null ? Number(caja.fondoProveedores) : null;
            const fechaCaja = moment(caja.fecha).format('YYYY-MM-DD');

            // Histórica: hasta el día de la migration inclusive (el diagnóstico 3.4-0 mostró que ese día
            // todavía tiene diferencias; desde el día siguiente hay 0 en los 3 comercios).
            const corte = await ObtenerCorteHistorico(conn);
            const historica = corte != null && fechaCaja <= corte;
            //#endregion

            //#region Ventas que cuentan
            const [ventasRows] = await conn.query(
                `SELECT COUNT(*) AS cantidad, COALESCE(SUM(v.total), 0) AS total
                 FROM ventas v WHERE v.idCaja = ? AND ${VENTA_CUENTA}`, [idCaja]
            ) as [any[], any];
            const cantidadVentas = Number(ventasRows[0].cantidad);
            const recalculado = r2(ventasRows[0].total);
            //#endregion

            //#region Medios de pago (solo el pago original de la venta)
            const [mediosRows] = await conn.query(
                `SELECT UPPER(tp.nombre) AS medio, COUNT(DISTINCT v.id) AS cantidadVentas, COALESCE(SUM(vpd.monto), 0) AS total
                 FROM ventas_pagos_detalle vpd
                 INNER JOIN ventas v ON v.id = vpd.idVenta
                 INNER JOIN tipos_pago tp ON tp.id = vpd.idTPago
                 WHERE v.idCaja = ? AND ${VENTA_CUENTA} AND ${VPD_VENTA}
                 GROUP BY UPPER(tp.nombre)`, [idCaja]
            ) as [any[], any];

            let ventasEfectivo = 0, saldoAFavorUsado = 0;
            const otrosMedios: { medio: string; cantidadVentas: number; total: number }[] = [];
            for (const m of mediosRows) {
                if (m.medio === MEDIO_EFECTIVO) ventasEfectivo = r2(m.total);
                else if (m.medio === MEDIO_SAF) saldoAFavorUsado = r2(m.total);
                else if (m.medio !== MEDIO_CC)
                    otrosMedios.push({ medio: m.medio, cantidadVentas: Number(m.cantidadVentas), total: r2(m.total) });
            }

            // Fiado = lo que la venta no cubrió con pagos originales (por venta, solo si es > 0).
            const [fiadoRows] = await conn.query(
                `SELECT COALESCE(SUM(GREATEST(v.total - COALESCE(p.pagado, 0), 0)), 0) AS fiado
                 FROM ventas v
                 LEFT JOIN (SELECT vpd.idVenta, SUM(vpd.monto) AS pagado
                            FROM ventas_pagos_detalle vpd WHERE ${VPD_VENTA} GROUP BY vpd.idVenta) p ON p.idVenta = v.id
                 WHERE v.idCaja = ? AND ${VENTA_CUENTA}`, [idCaja]
            ) as [any[], any];
            const fiado = r2(fiadoRows[0].fiado);
            //#endregion

            //#region Movimientos de caja, por origen
            const [movRows] = await conn.query(
                `SELECT ${MOV_ORIGEN} AS org, UPPER(cm.tipoMovimiento) AS tipoMov, COALESCE(SUM(cm.monto), 0) AS total
                 FROM cajas_movimientos cm WHERE cm.idCaja = ? GROUP BY 1, 2`, [idCaja]
            ) as [any[], any];
            const mov = (origen: string, tipo: string) =>
                Number(movRows.find((r: any) => r.org === origen && r.tipoMov === tipo)?.total ?? 0);

            const cobrosImputados = r2(mov('cobro', 'ENTRADA') - mov('cobro', 'SALIDA'));
            const ingresos = r2(mov('manual', 'ENTRADA'));
            const egresos = r2(mov('manual', 'SALIDA'));
            // Pagado a proveedores, neto de anulaciones (que entran como ENTRADA compensatoria).
            const proveedoresPagado = r2(mov('proveedor', 'SALIDA') - mov('proveedor', 'ENTRADA'));
            //#endregion

            //#region Fondo de proveedores
            let fondo: any = null;
            let pagosProveedorSinFondo = 0;
            let excedenteProveedores = 0;
            if (fondoAsignado != null) {
                excedenteProveedores = r2(Math.max(0, proveedoresPagado - fondoAsignado));
                const [pagosRows] = await conn.query(
                    `SELECT pm.id AS idMovimiento, p.nombre AS proveedor, f.comprobante, pm.haber AS monto,
                            pm.fecha, pm.hora, pm.anulado
                     FROM proveedor_cuenta_movimientos pm
                     INNER JOIN proveedores p ON p.id = pm.idProveedor
                     LEFT JOIN proveedor_cuenta_movimientos f ON f.id = pm.idReferencia AND f.tipo = 'factura'
                     WHERE pm.idCaja = ? AND pm.tipo = 'pago' ORDER BY pm.id`, [idCaja]
                ) as [any[], any];
                fondo = {
                    asignado: r2(fondoAsignado),
                    pagado: proveedoresPagado,
                    disponible: r2(Math.max(0, fondoAsignado - proveedoresPagado)),
                    excedente: excedenteProveedores,
                    pagos: pagosRows.map((r: any) => ({
                        idMovimiento: r.idMovimiento,
                        proveedor: r.proveedor,
                        comprobante: r.comprobante ?? null,
                        monto: r2(r.monto),
                        fecha: moment(r.fecha).format('YYYY-MM-DD'),
                        hora: r.hora,
                        anulado: Number(r.anulado) === 1,
                    })),
                };
            } else {
                // Caja sin fondo: el pago a proveedor sale del cajón como egreso marcado "Pago a proveedor".
                pagosProveedorSinFondo = proveedoresPagado;
            }
            //#endregion

            const cambioInicial = r2(Number(caja.inicial ?? 0) - (fondoAsignado ?? 0));
            const esperado = r2(cambioInicial + ventasEfectivo + cobrosImputados + ingresos - egresos
                                - pagosProveedorSinFondo - excedenteProveedores);

            //#region Info
            const cobrosFuera = await this.CobrosFueraDeCaja(idCaja);

            // NC: consulta propia. NotasCreditoRepo.ObtenerResumenPorCaja filtra v.fechaBaja IS NULL y deja
            // afuera justamente las NC totales (que le ponen fechaBaja a la venta).
            const [ncRows] = await conn.query(
                `SELECT COUNT(*) AS cantidad, COALESCE(SUM(nc.total), 0) AS total
                 FROM notas_credito nc INNER JOIN ventas v ON v.id = nc.idVenta WHERE v.idCaja = ?`, [idCaja]
            ) as [any[], any];

            // Anulaciones: ventas con baja SIN NC total. Usuario y puesto salen del evento VENTA_ANULAR.
            const [anulRows] = await conn.query(
                `SELECT v.id AS idVenta, v.total, e.fecha AS fechaEvento, u.nombre AS usuario, pu.nombre AS puesto
                 FROM ventas v
                 LEFT JOIN eventos e ON e.id = (SELECT MAX(e2.id) FROM eventos e2
                                                WHERE e2.accion = 'VENTA_ANULAR' AND e2.entidad = 'ventas' AND e2.entidadId = v.id)
                 LEFT JOIN usuarios u ON u.id = e.idUsuario
                 LEFT JOIN puestos pu ON pu.id = e.idPuesto
                 WHERE v.idCaja = ? AND v.fechaBaja IS NOT NULL
                   AND NOT EXISTS (SELECT 1 FROM notas_credito nct WHERE nct.idVenta = v.id AND nct.esParcial = 0)
                 ORDER BY v.id`, [idCaja]
            ) as [any[], any];
            const anulItems = anulRows.map((r: any) => ({
                idVenta: r.idVenta,
                hora: r.fechaEvento ? moment(r.fechaEvento).format('HH:mm') : null,
                total: r2(r.total),
                usuario: r.usuario ?? null,
                puesto: r.puesto ?? null,
            }));
            //#endregion

            const acumulador = r2(caja.ventas);
            // Caja histórica: ventas.total no representa lo cobrado; el acumulador es la mejor evidencia.
            const totalVendido = historica ? acumulador : recalculado;
            const desvio = historica ? null : r2(acumulador - recalculado);

            return {
                caja: {
                    id: caja.id,
                    responsable: caja.responsable,
                    apertura: { fecha: fechaCaja, hora: caja.hora },
                    finalizada: Number(caja.finalizada) === 1,
                    fondoProveedores: fondoAsignado,
                    historica,
                    corteHistorico: corte,
                },
                cajon: {
                    cambioInicial,
                    ventasEfectivo,
                    cobrosImputados,
                    ingresos,
                    egresos,
                    pagosProveedorSinFondo,
                    excedenteProveedores,
                    esperado,
                },
                fondo,
                otrosMedios,
                info: {
                    totalVendido,
                    cantidadVentas,
                    fiado,
                    saldoAFavorUsado,
                    cobrosFueraDeCaja: cobrosFuera,
                    notasCredito: { cantidad: Number(ncRows[0].cantidad), total: r2(ncRows[0].total) },
                    anulaciones: { cantidad: anulItems.length, total: r2(anulItems.reduce((s: number, i: any) => s + i.total, 0)), items: anulItems },
                },
                control: { ventasAcumulador: acumulador, ventasRecalculado: recalculado, desvio },
            };

        } finally {
            if (!externa) conn.release();
        }
    }

    // Cobros de fiado que NO están en el efectivo de esta caja: sin imputar o imputados a otra caja,
    // en la fecha de apertura de ésta. Mismo criterio que ObtenerCobrosCaja (que ya resuelve el
    // histórico de 'pago completo'); acá se descartan los de "esta-caja", que ya van en cobrosImputados.
    private async CobrosFueraDeCaja(idCaja: number) {
        const cobros = await CuentasRepo.ObtenerCobrosCaja(idCaja);
        const items = cobros.filter((c: any) => c.asociacion !== 'esta-caja');
        return {
            cantidad: items.length,
            total: r2(items.reduce((s: number, c: any) => s + Number(c.monto), 0)),
            items,
        };
    }
}

export const ResumenCajaServ = new ResumenCajaService();
