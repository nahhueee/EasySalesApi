/**
 * Apertura de cuenta corriente para clientes que se saltearon en
 * snapshotAperturaCC.ts — Sub-fase B, parche.
 *
 * Contexto (2026-07-22): en al menos un comercio, se instaló la versión
 * nueva (que ya registra movimiento tipo='venta' en el ledger para CUALQUIER
 * venta a un cliente nombrado, sea fiado o pagada — ver ventasRepository.ts
 * Agregar(), linea ~264) ANTES de correr snapshotAperturaCC.ts. Como ese
 * script saltea a todo cliente que "ya tenga algun movimiento"
 * (yaTieneMovimientos), cualquier cliente que compró algo en esa ventana
 * quedó con SOLO esa venta nueva en el ledger, sin la apertura que resume
 * su deuda histórica previa. El saldo que ve la app para esos clientes está
 * incompleto (le falta todo lo de antes de la actualización).
 *
 * Esto detecta esos casos solo (no hace falta saber cuáles son a mano):
 * cliente con movimientos en el ledger, pero NINGUNO de tipo 'apertura'.
 *
 * Para cada uno, calcula la deuda histórica de la MISMA forma que
 * snapshotAperturaCC.ts (total desde ventas_detalle, no ventas.total),
 * pero EXCLUYENDO las ventas que ya tienen su propio movimiento tipo='venta'
 * en el ledger (para no duplicar lo que esa venta nueva ya aportó).
 *
 * Modo preview (default) — solo calcula y muestra, NO inserta nada:
 *   npx ts-node src/scripts/snapshotAperturaFaltantes.ts
 *
 * Modo confirmar — inserta el movimiento de apertura faltante:
 *   npx ts-node src/scripts/snapshotAperturaFaltantes.ts --confirmar
 *
 * Igual que el script original: preview es obligatorio, validar con el
 * dueño del comercio antes de confirmar.
 */
import db from '../db';
import { CuentaCorrienteRepo } from '../data/cuentaCorrienteRepository';

interface FilaPreview {
    idCliente: number;
    nombre: string;
    saldoLedgerActual: number;
    ventasYaEnLedger: number;
    saldoHistoricoFaltante: number;
    saldoFinalProyectado: number;
}

async function ObtenerCandidatos(): Promise<{ id: number; nombre: string }[]> {
    const connection = await db.getConnection();
    try {
        // Clientes con movimientos en el ledger, pero sin ningún 'apertura' entre ellos.
        const [rows] = await connection.query(
            `SELECT c.id, c.nombre
             FROM clientes c
             WHERE c.fechaBaja IS NULL
               AND EXISTS (SELECT 1 FROM cuenta_corriente_movimientos m WHERE m.idCliente = c.id)
               AND NOT EXISTS (
                   SELECT 1 FROM cuenta_corriente_movimientos m
                   WHERE m.idCliente = c.id AND m.tipo = 'apertura'
               )
             ORDER BY c.nombre`
        );
        return rows as any[];
    } finally {
        connection.release();
    }
}

/**
 * Deuda histórica pendiente de un cliente, calculada desde ventas_detalle,
 * EXCLUYENDO las ventas que ya tienen su propio movimiento tipo='venta' en
 * el ledger (esas ya están contabilizadas, sumarlas de nuevo las duplicaría).
 */
async function ObtenerSaldoHistoricoFaltante(idCliente: number): Promise<{ saldo: number; ventasExcluidas: number }> {
    const connection = await db.getConnection();
    try {
        const [excluidasRows] = await connection.query(
            `SELECT idReferencia FROM cuenta_corriente_movimientos WHERE idCliente = ? AND tipo = 'venta'`,
            [idCliente]
        );
        const idsExcluidos: number[] = (excluidasRows as any[]).map(r => r.idReferencia);

        const filtroExclusion = idsExcluidos.length > 0
            ? `AND v.id NOT IN (${idsExcluidos.map(() => '?').join(',')})`
            : '';

        const [rows] = await connection.query(
            `SELECT COALESCE(SUM(det.total - COALESCE(p.entrega, 0)), 0) AS saldo
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
               ${filtroExclusion}`,
            [idCliente, ...idsExcluidos]
        );

        return { saldo: Number((rows as any)[0].saldo), ventasExcluidas: idsExcluidos.length };
    } finally {
        connection.release();
    }
}

async function ObtenerSaldoLedgerActual(idCliente: number): Promise<number> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            'SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = ? ORDER BY id DESC LIMIT 1',
            [idCliente]
        );
        const ultimo = (rows as any)[0];
        return ultimo ? Number(ultimo.saldo) : 0;
    } finally {
        connection.release();
    }
}

async function CalcularPreview(): Promise<FilaPreview[]> {
    const candidatos = await ObtenerCandidatos();
    const filas: FilaPreview[] = [];

    for (const c of candidatos) {
        const { saldo, ventasExcluidas } = await ObtenerSaldoHistoricoFaltante(c.id);
        const saldoLedgerActual = await ObtenerSaldoLedgerActual(c.id);

        filas.push({
            idCliente: c.id,
            nombre: c.nombre,
            saldoLedgerActual,
            ventasYaEnLedger: ventasExcluidas,
            saldoHistoricoFaltante: saldo,
            saldoFinalProyectado: saldoLedgerActual + saldo
        });
    }

    return filas;
}

async function Confirmar(filas: FilaPreview[]): Promise<void> {
    // Si no hay deuda histórica faltante, no tiene sentido insertar una
    // apertura en 0 — el cliente ya está bien representado con lo que tiene.
    const pendientes = filas.filter(f => f.saldoHistoricoFaltante !== 0);

    for (const fila of pendientes) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                idCliente: fila.idCliente,
                tipo: 'apertura',
                descripcion: 'Saldo anterior (snapshot de apertura — parche clientes salteados)',
                debe: fila.saldoHistoricoFaltante > 0 ? fila.saldoHistoricoFaltante : 0,
                haber: fila.saldoHistoricoFaltante < 0 ? Math.abs(fila.saldoHistoricoFaltante) : 0,
                idReferencia: null
            });

            await connection.commit();
            console.log(`Cliente ${fila.idCliente} (${fila.nombre}): apertura de ${fila.saldoHistoricoFaltante.toFixed(2)} registrada. Saldo final: ${fila.saldoFinalProyectado.toFixed(2)}`);

        } catch (error) {
            await connection.rollback();
            console.error(`ERROR en cliente ${fila.idCliente} (${fila.nombre}):`, error);
            throw error;
        } finally {
            connection.release();
        }
    }
}

async function Main() {
    const confirmar = process.argv.includes('--confirmar');

    console.log('Buscando clientes con movimientos en el ledger pero sin apertura...\n');
    const filas = await CalcularPreview();

    if (filas.length === 0) {
        console.log('No se encontró ningún cliente en esta situación. No hay nada para hacer.');
        process.exit(0);
    }

    console.log('idCliente | nombre | saldo ledger actual | ventas ya en ledger | deuda histórica faltante | saldo final proyectado');
    console.log('-'.repeat(110));
    for (const fila of filas) {
        console.log(
            `${fila.idCliente} | ${fila.nombre} | ${fila.saldoLedgerActual.toFixed(2)} | ${fila.ventasYaEnLedger} | ${fila.saldoHistoricoFaltante.toFixed(2)} | ${fila.saldoFinalProyectado.toFixed(2)}`
        );
    }

    if (!confirmar) {
        console.log('\nModo preview. No se insertó nada.');
        console.log('Validar estos saldos antes de confirmar. Si están correctos, volver a correr con --confirmar.');
        process.exit(0);
    }

    console.log('\nModo confirmar: insertando movimientos de apertura faltantes...\n');
    await Confirmar(filas);
    console.log('\nListo.');
    process.exit(0);
}

Main().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
});
