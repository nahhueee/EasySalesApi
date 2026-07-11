/**
 * Snapshot de apertura de cuenta corriente — Sub-fase B.
 *
 * Calcula el saldo actual de cada cliente con la logica ya existente y
 * confiada en produccion (CuentasRepo.ObtenerDeudaTotalCliente) e inserta
 * UN movimiento tipo='apertura' por cliente en cuenta_corriente_movimientos,
 * con ese saldo como punto de partida del ledger. El historial fino previo
 * sigue disponible en la pantalla actual de ventas-cliente; este snapshot
 * no lo reemplaza, solo le da al ledger un punto de arranque.
 *
 * Es de UN SOLO USO. Es idempotente respecto a clientes que ya tengan
 * algun movimiento (se salteann), pero no esta pensado para correrse
 * repetidas veces como rutina.
 *
 * Modo preview (default) — solo calcula y muestra, NO inserta nada:
 *   npx ts-node src/scripts/snapshotAperturaCC.ts
 *
 * Modo confirmar — inserta los movimientos de apertura:
 *   npx ts-node src/scripts/snapshotAperturaCC.ts --confirmar
 *
 * El preview es un paso obligatorio: los saldos calculados deben
 * validarse con el dueño del comercio antes de confirmar (es plata
 * de clientes reales).
 */
import db from '../db';
import { CuentasRepo } from '../data/cuentasCorsRepository';
import { CuentaCorrienteRepo } from '../data/cuentaCorrienteRepository';

interface FilaPreview {
    idCliente: number;
    nombre: string;
    saldo: number;
    yaTieneMovimientos: boolean;
}

/**
 * Calcula el saldo histórico de un cliente leyendo directamente las tablas
 * de ventas, SIN usar el ledger. Es la lógica que tenía ObtenerDeudaTotalCliente
 * antes de la libreta completa.
 *
 * Necesaria para clientes que aún no tienen movimientos en cuenta_corriente_movimientos
 * (es decir, no pasaron por el snapshot de Sub-fase B). En ese caso ObtenerSaldoLedger
 * devuelve 0, lo que crearía aperturas incorrectas.
 *
 * Fórmula: SUM(v.total - p.entrega) para todas las ventas no realizadas y no dadas de baja.
 * p.entrega es acumulativo (seña inicial + entregas posteriores vía ActualizarEstadoPago).
 */
async function ObtenerSaldoDesdeVentas(idCliente: number): Promise<number> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT COALESCE(SUM(v.total - COALESCE(p.entrega, 0)), 0) AS saldo
             FROM ventas v
             INNER JOIN ventas_pago p ON p.idVenta = v.id
             WHERE v.idCliente = ?
               AND p.realizado = 0
               AND v.fechaBaja IS NULL`,
            [idCliente]
        );
        return Number((rows as any)[0].saldo);
    } finally {
        connection.release();
    }
}

async function CalcularPreview(): Promise<FilaPreview[]> {
    const connection = await db.getConnection();
    let clientes: any[];
    let idsConMovimientos: Set<number>;

    try {
        const [rowsClientes] = await connection.query('SELECT id, nombre FROM clientes WHERE fechaBaja IS NULL ORDER BY id');
        clientes = rowsClientes as any[];

        const [rowsMovimientos] = await connection.query('SELECT DISTINCT idCliente FROM cuenta_corriente_movimientos');
        idsConMovimientos = new Set((rowsMovimientos as any[]).map(r => r.idCliente));
    } finally {
        connection.release();
    }

    const filas: FilaPreview[] = [];

    for (const cliente of clientes) {
        const yaTieneMovimientos = idsConMovimientos.has(cliente.id);

        // Si ya tiene movimientos en el ledger (Sub-fase B corrida):
        //   ObtenerDeudaTotalCliente lee el ledger → correcto.
        // Si NO tiene movimientos (cliente sin snapshot previo):
        //   ObtenerDeudaTotalCliente delegaría a ObtenerSaldoLedger → devolvería 0 → incorrecto.
        //   En ese caso calculamos desde las tablas de ventas directamente.
        const saldo = yaTieneMovimientos
            ? await CuentasRepo.ObtenerDeudaTotalCliente(cliente.id)
            : await ObtenerSaldoDesdeVentas(cliente.id);

        filas.push({
            idCliente: cliente.id,
            nombre: cliente.nombre,
            saldo: Number(saldo) || 0,
            yaTieneMovimientos
        });
    }

    return filas;
}

async function Confirmar(filas: FilaPreview[]): Promise<void> {
    const pendientes = filas.filter(f => !f.yaTieneMovimientos);

    for (const fila of pendientes) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                idCliente: fila.idCliente,
                tipo: 'apertura',
                descripcion: 'Saldo anterior (snapshot de apertura del ledger)',
                debe: fila.saldo > 0 ? fila.saldo : 0,
                haber: fila.saldo < 0 ? Math.abs(fila.saldo) : 0,
                idReferencia: null
            });

            await connection.commit();
            console.log(`Cliente ${fila.idCliente} (${fila.nombre}): apertura registrada, saldo ${fila.saldo.toFixed(2)}`);

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

    console.log('Calculando saldos actuales por cliente...\n');
    const filas = await CalcularPreview();

    console.log('idCliente | nombre | saldo calculado');
    console.log('-'.repeat(70));
    for (const fila of filas) {
        const aviso = fila.yaTieneMovimientos ? '  (SE SALTEA: ya tiene movimientos en el ledger)' : '';
        console.log(`${fila.idCliente} | ${fila.nombre} | ${fila.saldo.toFixed(2)}${aviso}`);
    }

    const totalDeuda = filas.reduce((acc, f) => acc + f.saldo, 0);
    console.log('-'.repeat(70));
    console.log(`Total clientes: ${filas.length} | Suma de saldos: ${totalDeuda.toFixed(2)}\n`);

    if (!confirmar) {
        console.log('Modo preview. No se insertó nada.');
        console.log('Validar estos saldos con el dueño antes de confirmar. Si están correctos, volver a correr con --confirmar.');
        process.exit(0);
    }

    console.log('Modo confirmar: insertando movimientos de apertura...\n');
    await Confirmar(filas);
    console.log('\nListo.');
    process.exit(0);
}

Main().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
});
