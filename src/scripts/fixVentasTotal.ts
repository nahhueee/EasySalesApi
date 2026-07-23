/**
 * Reparación de ventas.total en NULL — comercios afectados por el cuelgue de
 * la migración 20260622091000_ventas_total.js (backfill original con subquery
 * correlacionado sin índice en ventas_detalle.idVenta).
 *
 * Hace exactamente lo mismo que el backfill corregido de esa migración
 * (índice + UPDATE con JOIN agregado), pero como script standalone: sirve
 * para arreglar un comercio YA en producción sin depender de si su
 * knex_migrations tiene o no un registro de esa migración, o de si hubo
 * que sacarla a mano en esa máquina.
 *
 * Es idempotente: solo toca filas con total IS NULL. Correrlo de nuevo
 * sobre un comercio ya reparado no hace nada.
 *
 * Modo preview (default) — solo calcula y muestra, NO escribe nada:
 *   npx ts-node src/scripts/fixVentasTotal.ts
 *
 * Modo confirmar — aplica el índice (si falta) y el backfill:
 *   npx ts-node src/scripts/fixVentasTotal.ts --confirmar
 *
 * Correr esto ANTES de snapshotAperturaCC.ts en un comercio con arrastre
 * de este bug no es estrictamente necesario (el snapshot ya calcula el
 * saldo desde ventas_detalle, no desde ventas.total), pero deja total
 * consistente para todo lo demás que sí lo usa (ledger, reportes futuros).
 */
import db from '../db';

interface Resumen {
    totalVentas: number;
    conNull: number;
    conValor: number;
    tieneIndice: boolean;
}

async function Diagnosticar(): Promise<Resumen> {
    const connection = await db.getConnection();
    try {
        const [rows] = await connection.query(
            `SELECT
                COUNT(*) AS totalVentas,
                SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END) AS conNull,
                SUM(CASE WHEN total IS NOT NULL THEN 1 ELSE 0 END) AS conValor
             FROM ventas`
        );

        const [idxRows] = await connection.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
             WHERE table_schema = DATABASE() AND table_name = 'ventas_detalle' AND index_name = 'idx_ventas_detalle_idVenta'`
        );

        const fila = (rows as any)[0];
        return {
            totalVentas: Number(fila.totalVentas),
            conNull: Number(fila.conNull),
            conValor: Number(fila.conValor),
            tieneIndice: Number((idxRows as any)[0].cnt) > 0
        };
    } finally {
        connection.release();
    }
}

async function AplicarIndice(): Promise<void> {
    const connection = await db.getConnection();
    try {
        const [idxRows] = await connection.query(
            `SELECT COUNT(*) AS cnt FROM information_schema.STATISTICS
             WHERE table_schema = DATABASE() AND table_name = 'ventas_detalle' AND index_name = 'idx_ventas_detalle_idVenta'`
        );
        if (Number((idxRows as any)[0].cnt) === 0) {
            console.log('Creando índice idx_ventas_detalle_idVenta en ventas_detalle...');
            await connection.query(
                `ALTER TABLE ventas_detalle ADD INDEX idx_ventas_detalle_idVenta (idVenta)`
            );
            console.log('Índice creado.');
        } else {
            console.log('El índice ya existe, no hace falta crearlo.');
        }
    } finally {
        connection.release();
    }
}

async function AplicarBackfill(): Promise<void> {
    const connection = await db.getConnection();
    try {
        console.log('Recalculando ventas.total desde ventas_detalle (UPDATE con JOIN, una sola pasada)...');

        const [resultado] = await connection.query(
            `UPDATE ventas v
             JOIN (
                SELECT idVenta, COALESCE(SUM(cantidad * precio), 0) AS tot
                FROM ventas_detalle
                GROUP BY idVenta
             ) d ON d.idVenta = v.id
             SET v.total = d.tot
             WHERE v.total IS NULL`
        );
        console.log(`Filas actualizadas desde detalle: ${(resultado as any).affectedRows}`);

        // Ventas sin ningún renglón en ventas_detalle (no deberían existir en
        // circulación normal): no las toca el JOIN de arriba. Quedan en 0.
        const [resultadoResto] = await connection.query(
            `UPDATE ventas SET total = 0 WHERE total IS NULL`
        );
        const filasResto = (resultadoResto as any).affectedRows;
        if (filasResto > 0) {
            console.log(`Filas sin detalle asociado, dejadas en 0: ${filasResto}`);
        }
    } finally {
        connection.release();
    }
}

async function Main() {
    const confirmar = process.argv.includes('--confirmar');

    console.log('Diagnóstico de ventas.total...\n');
    const resumen = await Diagnosticar();

    console.log(`Total de ventas:        ${resumen.totalVentas}`);
    console.log(`Con total en NULL:      ${resumen.conNull}`);
    console.log(`Con total OK:           ${resumen.conValor}`);
    console.log(`Índice idVenta ya existe: ${resumen.tieneIndice ? 'sí' : 'no'}`);
    console.log('');

    if (resumen.conNull === 0) {
        console.log('No hay nada para corregir. No se hizo ningún cambio.');
        process.exit(0);
    }

    if (!confirmar) {
        console.log(`Modo preview. Se corregirían ${resumen.conNull} ventas. No se escribió nada.`);
        console.log('Si está correcto, volver a correr con --confirmar.');
        process.exit(0);
    }

    console.log('Modo confirmar: aplicando índice y backfill...\n');
    await AplicarIndice();
    await AplicarBackfill();
    console.log('\nListo.');
    process.exit(0);
}

Main().catch((error) => {
    console.error('Error fatal:', error);
    process.exit(1);
});
