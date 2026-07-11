import moment from 'moment';

export type TipoMovimientoCC = 'apertura' | 'venta' | 'entrega' | 'nota_credito' | 'ajuste';

export interface MovimientoCC {
    idCliente: number;
    tipo: TipoMovimientoCC;
    descripcion: string;
    debe?: number;
    haber?: number;
    idReferencia?: number | null;
}

class CuentaCorrienteRepository {

    // Inserta un movimiento en el ledger y devuelve el saldo resultante.
    // IMPORTANTE: debe llamarse con una connection que ya tiene una transaccion
    // abierta por el caller (venta a credito, entrega de dinero, etc.) — esta
    // funcion no abre ni cierra transaccion ni libera la connection.
    async RegistrarMovimiento(connection, mov: MovimientoCC): Promise<number> {
        try {
            // Lockeamos la fila del cliente (no el ultimo movimiento) para serializar
            // los movimientos concurrentes de ese cliente. Lockear "el ultimo movimiento"
            // falla si el cliente todavia no tiene ninguno (no hay fila que lockear),
            // dejando una ventana de carrera para el primer movimiento de un cliente nuevo.
            await connection.query('SELECT id FROM clientes WHERE id = ? FOR UPDATE', [mov.idCliente]);

            const [ultimo] = await connection.query(
                'SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = ? ORDER BY id DESC LIMIT 1',
                [mov.idCliente]
            );

            const saldoAnterior = ultimo.length > 0 ? parseFloat(ultimo[0].saldo) : 0;
            // Number(...) y no solo "?? 0": mysql2 devuelve columnas DECIMAL como
            // string, y un caller podria pasar ese valor sin parsear (ya paso una
            // vez). saldoAnterior + "150.00" concatena en vez de sumar.
            const debe = Number(mov.debe ?? 0);
            const haber = Number(mov.haber ?? 0);
            const saldoNuevo = saldoAnterior + debe - haber;

            const ahora = moment();

            await connection.query(
                `INSERT INTO cuenta_corriente_movimientos
                    (idCliente, fecha, hora, tipo, descripcion, debe, haber, idReferencia, saldo)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    mov.idCliente,
                    ahora.format('YYYY-MM-DD'),
                    ahora.format('HH:mm'),
                    mov.tipo,
                    mov.descripcion,
                    debe,
                    haber,
                    mov.idReferencia ?? null,
                    saldoNuevo
                ]
            );

            return saldoNuevo;

        } catch (error) {
            throw error;
        }
    }
}

export const CuentaCorrienteRepo = new CuentaCorrienteRepository();
