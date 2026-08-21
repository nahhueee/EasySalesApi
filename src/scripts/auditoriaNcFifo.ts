/**
 * Auditoría: ventas acreditadas al 100% por Nota de Crédito que quedaron con
 * ventas_pago.realizado = 0 — el síntoma del bug encontrado en ObtenerVentasImpagas
 * (cuentasCorsRepository.ts): esa función arma el pool de "deuda pendiente" para el
 * reparto FIFO de EntregaDinero filtrando solo `p.realizado = 0`, sin excluir ventas
 * ya cubiertas por una NC total ni ventas dadas de baja (mismo patrón que el Bug 3 ya
 * documentado y corregido en ObtenerDeudaTotalCliente, pero que acá quedó afuera).
 *
 * Efecto concreto: si una venta con NC total sigue en el pool, una entrega de dinero
 * genérica posterior puede "gastar" plata real del cliente en saldarla de nuevo —
 * plata que en realidad correspondía a otras ventas más viejas que sí seguían debiendo.
 * Caso real detectado y reconstruido a mano: cliente ZAZU VIVIANA OLGA (2026-08-21),
 * donde $169.800 de una entrega de $268.160 se aplicaron a una venta ya saldada por
 * NC, y alguien lo terminó tapando a mano con dos "Pago manual de venta" el mismo día
 * que se hizo el fix de este bug — ver [[project_...]] / conversación 2026-08-21.
 *
 * Este script NO modifica nada en la base — solo lee y genera un .xlsx con:
 *   - Cada venta afectada (NC total + realizado=0 + fechaBaja IS NULL).
 *   - Cuánta plata de entregas quedó mal aplicada ahí (ventas_pago.entrega).
 *   - Si ya existe un "Pago manual de venta" (ajuste) registrado exactamente para esa
 *     venta — señal de que probablemente ya se parchó a mano, como en ZAZU — usando
 *     idReferencia del ledger, que en ActualizarEstadoPago apunta al id de la venta.
 *
 * Uso:
 *   npx ts-node src/scripts/auditoriaNcFifo.ts   (entorno de desarrollo)
 *   node src/scripts/auditoriaNcFifo.js          (máquina cliente con build ya compilado)
 *
 * Genera reportes/auditoria_nc_fifo_<fecha>.xlsx en la raíz del proyecto API.
 */
import path from 'path';
import * as XLSX from 'xlsx';
import db from '../db';

interface CasoDetectado {
    idCliente: number;
    cliente: string;
    idVenta: number;
    fechaVenta: string;
    totalVenta: number;
    acreditadoNC: number;
    fechaNC: string;
    entregaMalAplicada: number;
    tieneParcheManual: boolean;
}

/**
 * Trae, en una sola query, toda venta con fechaBaja IS NULL, realizado = 0, y
 * acreditada al 100% por NC (SUM(notas_credito.total) >= total de la venta, calculado
 * desde ventas_detalle — no desde ventas.total, mismo criterio que snapshotAperturaCC.ts
 * y reporteDeudaClientes.ts, ver incidente 2026-07-22).
 *
 * tieneParcheManual: existe un movimiento 'ajuste'/'Pago manual de venta' en el ledger
 * con idReferencia = esta venta — es exacto, no heurístico, porque ActualizarEstadoPago
 * siempre postea idReferencia: data.idVenta.
 */
async function ObtenerCasos(): Promise<CasoDetectado[]> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT
                v.idCliente, cli.nombre AS cliente,
                v.id AS idVenta, v.fecha AS fechaVenta,
                det.total AS totalVenta,
                COALESCE(p.entrega, 0) AS entregaMalAplicada,
                nc.acreditado AS acreditadoNC,
                nc.fechaNC,
                EXISTS(
                    SELECT 1 FROM cuenta_corriente_movimientos ccm
                    WHERE ccm.idCliente = v.idCliente
                      AND ccm.tipo = 'ajuste'
                      AND ccm.descripcion = 'Pago manual de venta'
                      AND ccm.idReferencia = v.id
                ) AS tieneParcheManual
             FROM ventas v
             INNER JOIN clientes cli ON cli.id = v.idCliente
             INNER JOIN ventas_pago p ON p.idVenta = v.id
             INNER JOIN (
                SELECT idVenta, SUM(cantidad * precio) AS total
                FROM ventas_detalle
                GROUP BY idVenta
             ) det ON det.idVenta = v.id
             INNER JOIN (
                SELECT idVenta, SUM(total) AS acreditado, MAX(fecha) AS fechaNC
                FROM notas_credito
                GROUP BY idVenta
             ) nc ON nc.idVenta = v.id
             WHERE v.fechaBaja IS NULL
               AND p.realizado = 0
               AND nc.acreditado >= det.total
             ORDER BY entregaMalAplicada DESC, v.fecha ASC`
        );

        return (rows as any[]).map(r => ({
            idCliente: r.idCliente,
            cliente: r.cliente,
            idVenta: r.idVenta,
            fechaVenta: r.fechaVenta,
            totalVenta: Number(r.totalVenta),
            acreditadoNC: Number(r.acreditadoNC),
            fechaNC: r.fechaNC,
            entregaMalAplicada: Number(r.entregaMalAplicada),
            tieneParcheManual: !!r.tieneParcheManual
        }));
    } finally {
        connection.release();
    }
}

function ArmarHoja(casos: CasoDetectado[]): XLSX.WorkSheet {
    const filas = casos.map(c => ({
        'ID Cliente': c.idCliente,
        'Cliente': c.cliente,
        'Nro Venta': c.idVenta,
        'Fecha venta': c.fechaVenta,
        'Total venta': c.totalVenta,
        'Acreditado por NC': c.acreditadoNC,
        'Fecha NC': c.fechaNC,
        'Plata de entregas mal aplicada': c.entregaMalAplicada,
        'Estado': c.entregaMalAplicada === 0
            ? 'En riesgo (sin daño todavía)'
            : (c.tieneParcheManual ? 'Ya parchado a mano' : 'PENDIENTE — plata mal aplicada sin corregir')
    }));

    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [
        { wch: 10 }, { wch: 28 }, { wch: 10 }, { wch: 12 },
        { wch: 14 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 32 }
    ];
    return hoja;
}

async function Main() {
    console.log('Auditando ventas con NC total y realizado=0 (bug de ObtenerVentasImpagas)...\n');

    const casos = await ObtenerCasos();

    if (casos.length === 0) {
        console.log('No se encontró ningún caso. El bug no dejó rastro pendiente en los datos actuales.');
        process.exit(0);
    }

    const pendientes = casos.filter(c => c.entregaMalAplicada > 0 && !c.tieneParcheManual);
    const yaParchados = casos.filter(c => c.entregaMalAplicada > 0 && c.tieneParcheManual);
    const enRiesgo = casos.filter(c => c.entregaMalAplicada === 0);
    const totalPendiente = pendientes.reduce((acc, c) => acc + c.entregaMalAplicada, 0);

    console.log(`Casos totales detectados: ${casos.length}`);
    console.log(`  - PENDIENTES (plata mal aplicada, sin parche manual): ${pendientes.length} — $${totalPendiente.toFixed(2)} en juego`);
    console.log(`  - Ya parchados a mano (como ZAZU): ${yaParchados.length}`);
    console.log(`  - En riesgo, sin daño todavía (nadie les aplicó plata aún): ${enRiesgo.length}`);

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ArmarHoja(casos), 'Casos NC + FIFO');

    const fecha = new Date().toISOString().slice(0, 10);
    const outDir = path.resolve(__dirname, '../../reportes');
    const outPath = path.join(outDir, `auditoria_nc_fifo_${fecha}.xlsx`);

    const fs = require('fs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    XLSX.writeFile(workbook, outPath);

    console.log(`\nReporte generado: ${outPath}`);
    process.exit(0);
}

Main().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
});
