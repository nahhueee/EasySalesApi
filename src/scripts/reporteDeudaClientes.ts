/**
 * Reporte de deuda por cliente, con detalle venta por venta — para que el
 * dueño del comercio pueda cobrar sabiendo qué compone cada saldo, y
 * mostrarle a cada cliente solo lo suyo (no la deuda de los demás).
 *
 * Complementa a snapshotAperturaCC.ts: ese script resume todo el historial
 * de cada cliente en UN movimiento de apertura en el ledger (perdiendo el
 * detalle venta por venta a propósito, para no reimplementar el historial
 * fino en la libreta). Este reporte es la foto de ese detalle ANTES de
 * resumirlo, para que quede guardada aparte.
 *
 * Usa la misma lógica de cálculo que snapshotAperturaCC.ts (total desde
 * ventas_detalle, no desde ventas.total — ver incidente 2026-07-22) para
 * que los saldos coincidan con los que ya validaste en el preview de apertura.
 *
 * No modifica nada en la base — solo lee y genera un archivo .xlsx.
 *
 * Uso:
 *   npx ts-node src/scripts/reporteDeudaClientes.ts
 *
 * Genera reportes/deuda_clientes_<fecha>.xlsx en la raíz del proyecto API.
 */
import path from 'path';
import * as XLSX from 'xlsx';
import db from '../db';

interface FilaDetalle {
    idVenta: number;
    fecha: string;
    total: number;
    entrega: number;
    saldo: number;
}

interface FilaEntrega {
    idEntrega: number;
    fecha: string;
    monto: number;
    detalle: string;
}

interface FilaPagoSinFecha {
    idVenta: number;
    total: number;
    fechaVenta: string;
}

interface ClienteConDeuda {
    idCliente: number;
    nombre: string;
    saldoTotal: number;
    detalle: FilaDetalle[];
    entregas: FilaEntrega[];
    pagosSinFecha: FilaPagoSinFecha[];
}

async function ObtenerClientes(): Promise<{ id: number; nombre: string }[]> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            'SELECT id, nombre FROM clientes WHERE fechaBaja IS NULL ORDER BY nombre'
        );
        return rows as any[];
    } finally {
        connection.release();
    }
}

/**
 * Detalle de ventas pendientes de un cliente, calculando el total desde
 * ventas_detalle (no desde ventas.total — ver snapshotAperturaCC.ts).
 */
async function ObtenerDetalleCliente(idCliente: number): Promise<FilaDetalle[]> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT v.id AS idVenta, v.fecha,
                    det.total AS total,
                    COALESCE(p.entrega, 0) AS entrega
             FROM ventas v
             INNER JOIN ventas_pago p ON p.idVenta = v.id
             INNER JOIN (
                SELECT idVenta, SUM(cantidad * precio) AS total
                FROM ventas_detalle
                GROUP BY idVenta
             ) det ON det.idVenta = v.id
             WHERE v.idCliente = ?
               AND p.realizado = 0
               AND v.fechaBaja IS NULL
             ORDER BY v.fecha ASC, v.id ASC`,
            [idCliente]
        );

        return (rows as any[]).map(r => {
            const total = Number(r.total);
            const entrega = Number(r.entrega);
            return {
                idVenta: r.idVenta,
                fecha: r.fecha,
                total,
                entrega,
                saldo: total - entrega
            };
        });
    } finally {
        connection.release();
    }
}

/**
 * Entregas de dinero registradas con fecha — solo cubre el flujo EntregaDinero
 * (cobro parcial o repartido entre varias ventas, tabla ventas_entrega). El otro
 * camino de cobro, ActualizarEstadoPago (marcar una venta fiado como pagada
 * completa de una), NO pasa por ventas_entrega y no guarda fecha de pago —
 * ver ObtenerPagosSinFechaCliente para esos casos.
 */
async function ObtenerEntregasCliente(idCliente: number): Promise<FilaEntrega[]> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT ve.id AS idEntrega, ve.fecha, ve.monto,
                    GROUP_CONCAT(
                        CONCAT('Venta ', ved.idVenta, ': $', ved.montoAplicado)
                        ORDER BY ved.idVenta SEPARATOR ' | '
                    ) AS detalle
             FROM ventas_entrega ve
             LEFT JOIN ventas_entrega_detalle ved ON ved.idEntrega = ve.id
             WHERE ve.idCliente = ?
             GROUP BY ve.id, ve.fecha, ve.monto
             ORDER BY ve.fecha ASC, ve.id ASC`,
            [idCliente]
        );

        return (rows as any[]).map(r => ({
            idEntrega: r.idEntrega,
            fecha: r.fecha,
            monto: Number(r.monto),
            detalle: r.detalle ?? ''
        }));
    } finally {
        connection.release();
    }
}

/**
 * Ventas de este cliente marcadas como pagadas por completo (realizado=1) que
 * NO tienen ningún renglón en ventas_entrega_detalle — es decir, se pagaron
 * vía ActualizarEstadoPago ("marcar como pagada"), no vía EntregaDinero. Ese
 * camino no guarda fecha de pago en ningún lado; la única fecha disponible es
 * la de la venta, que NO es la fecha en que se cobró. Se listan aparte y
 * marcadas como tales para no confundirlas con una entrega real fechada.
 */
async function ObtenerPagosSinFechaCliente(idCliente: number): Promise<FilaPagoSinFecha[]> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT v.id AS idVenta, v.fecha AS fechaVenta, det.total AS total
             FROM ventas v
             INNER JOIN ventas_pago p ON p.idVenta = v.id
             INNER JOIN (
                SELECT idVenta, SUM(cantidad * precio) AS total
                FROM ventas_detalle
                GROUP BY idVenta
             ) det ON det.idVenta = v.id
             WHERE v.idCliente = ?
               AND p.realizado = 1
               AND v.fechaBaja IS NULL
               AND NOT EXISTS (SELECT 1 FROM ventas_entrega_detalle ved WHERE ved.idVenta = v.id)
             ORDER BY v.fecha ASC, v.id ASC`,
            [idCliente]
        );

        return (rows as any[]).map(r => ({
            idVenta: r.idVenta,
            fechaVenta: r.fechaVenta,
            total: Number(r.total)
        }));
    } finally {
        connection.release();
    }
}

/**
 * Nombre de hoja de Excel válido: máximo 31 caracteres, sin \ / ? * [ ] :,
 * y único dentro del libro (se antepone el id del cliente para evitar
 * colisiones entre clientes con nombres parecidos o repetidos).
 */
function NombreHojaSeguro(idCliente: number, nombre: string): string {
    const limpio = (nombre || `Cliente ${idCliente}`).replace(/[\\/?*[\]:]/g, ' ').trim();
    const prefijo = `${idCliente} `;
    const disponible = 31 - prefijo.length;
    return prefijo + limpio.substring(0, disponible);
}

function ArmarHojaResumen(clientes: ClienteConDeuda[]): XLSX.WorkSheet {
    const filas = clientes
        .filter(c => c.saldoTotal !== 0)
        .sort((a, b) => b.saldoTotal - a.saldoTotal)
        .map(c => ({
            'ID Cliente': c.idCliente,
            'Cliente': c.nombre,
            'Saldo pendiente': c.saldoTotal
        }));

    const totalGeneral = filas.reduce((acc, f) => acc + f['Saldo pendiente'], 0);
    filas.push({ 'ID Cliente': '' as any, 'Cliente': 'TOTAL', 'Saldo pendiente': totalGeneral });

    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 16 }];
    return hoja;
}

function ArmarHojaCliente(cliente: ClienteConDeuda): XLSX.WorkSheet {
    const filas = cliente.detalle.map(d => ({
        'Fecha': d.fecha,
        'Nro Venta': d.idVenta,
        'Total': d.total,
        'Entregado': d.entrega,
        'Saldo pendiente': d.saldo
    }));

    filas.push({
        'Fecha': '' as any,
        'Nro Venta': '' as any,
        'Total': '' as any,
        'Entregado': 'TOTAL' as any,
        'Saldo pendiente': cliente.saldoTotal
    });

    const hoja = XLSX.utils.json_to_sheet(filas);
    hoja['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 60 }];

    let filaLibre = filas.length + 2; // +1 header, +1 para dejar la siguiente fila libre

    // Tabla 2: entregas de dinero con fecha (flujo EntregaDinero)
    filaLibre++; // fila en blanco antes del título
    XLSX.utils.sheet_add_aoa(hoja, [['Entregas de dinero registradas (con fecha)']], { origin: `A${filaLibre}` });
    filaLibre++;

    if (cliente.entregas.length > 0) {
        const filasEntregas = cliente.entregas.map(e => ({
            'Fecha': e.fecha,
            'Nro Entrega': e.idEntrega,
            'Monto entregado': e.monto,
            'Aplicado a': e.detalle
        }));
        const totalEntregado = cliente.entregas.reduce((acc, e) => acc + e.monto, 0);
        filasEntregas.push({
            'Fecha': '' as any, 'Nro Entrega': '' as any,
            'Monto entregado': totalEntregado, 'Aplicado a': 'TOTAL ENTREGADO (con fecha)' as any
        });
        XLSX.utils.sheet_add_json(hoja, filasEntregas, { origin: `A${filaLibre}` });
        filaLibre += filasEntregas.length + 1;
    } else {
        XLSX.utils.sheet_add_aoa(hoja, [['(sin entregas registradas por este medio)']], { origin: `A${filaLibre}` });
        filaLibre += 2;
    }

    // Tabla 3: ventas pagadas por completo sin fecha de pago (ActualizarEstadoPago)
    if (cliente.pagosSinFecha.length > 0) {
        filaLibre++;
        XLSX.utils.sheet_add_aoa(hoja, [
            ['Ventas pagadas por completo SIN fecha de pago registrada'],
            ['(marcadas como pagadas manualmente — el sistema no guarda cuándo se cobraron, solo la fecha de la venta)']
        ], { origin: `A${filaLibre}` });
        filaLibre += 2;

        const filasPagos = cliente.pagosSinFecha.map(p => ({
            'Fecha de la venta (no la del pago)': p.fechaVenta,
            'Nro Venta': p.idVenta,
            'Monto pagado': p.total
        }));
        XLSX.utils.sheet_add_json(hoja, filasPagos, { origin: `A${filaLibre}` });
    }

    return hoja;
}

async function Main() {
    console.log('Calculando deuda y detalle por cliente...\n');

    const clientesBase = await ObtenerClientes();
    const clientes: ClienteConDeuda[] = [];

    for (const c of clientesBase) {
        const detalle = await ObtenerDetalleCliente(c.id);
        if (detalle.length === 0) continue; // sin ventas pendientes, no aporta nada al reporte

        const saldoTotal = detalle.reduce((acc, d) => acc + d.saldo, 0);
        const entregas = await ObtenerEntregasCliente(c.id);
        const pagosSinFecha = await ObtenerPagosSinFechaCliente(c.id);

        clientes.push({ idCliente: c.id, nombre: c.nombre, saldoTotal, detalle, entregas, pagosSinFecha });
    }

    if (clientes.length === 0) {
        console.log('Ningún cliente tiene ventas pendientes. No se generó ningún archivo.');
        process.exit(0);
    }

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ArmarHojaResumen(clientes), 'Resumen');

    // Hoja individual por cliente, ordenados igual que el resumen (mayor deuda primero)
    const ordenados = [...clientes].sort((a, b) => b.saldoTotal - a.saldoTotal);
    for (const cliente of ordenados) {
        const nombreHoja = NombreHojaSeguro(cliente.idCliente, cliente.nombre);
        XLSX.utils.book_append_sheet(workbook, ArmarHojaCliente(cliente), nombreHoja);
    }

    const fecha = new Date().toISOString().slice(0, 10);
    const outDir = path.resolve(__dirname, '../../reportes');
    const outPath = path.join(outDir, `deuda_clientes_${fecha}.xlsx`);

    const fs = require('fs');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    XLSX.writeFile(workbook, outPath);

    console.log(`Reporte generado: ${outPath}`);
    console.log(`Clientes con deuda: ${clientes.length}`);
    process.exit(0);
}

Main().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
});
