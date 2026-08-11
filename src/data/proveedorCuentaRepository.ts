import moment from 'moment';
import { ResultSetHeader } from 'mysql2';
import db from '../db';
import { SesionServ } from '../services/sesionService';
import { MovimientosRepo } from './movimientosRepository';
import { ID_TIPO_PAGO_EFECTIVO } from './cuentasCorsRepository';

export type TipoMovimientoProveedor = 'apertura' | 'factura' | 'pago' | 'nota_credito' | 'ajuste';

export interface MovimientoProveedor {
    idProveedor: number;
    tipo: TipoMovimientoProveedor;
    descripcion: string;
    debe?: number;
    haber?: number;
    comprobante?: string | null;
    fechaVencimiento?: string | null;
    idTipoPago?: number | null;
    idCaja?: number | null;
    idReferencia?: number | null;
}

// Espejo de cuentaCorrienteRepository.ts, con la CONVENCIÓN DE SIGNO INVERTIDA a propósito:
//
//   clientes:    debe = lo que EL CLIENTE me debe
//   proveedores: debe = lo que YO le debo al PROVEEDOR
//
//   saldo > 0 ⇒ le debo plata al proveedor
//   saldo < 0 ⇒ le pagué de más / tengo saldo a cuenta
//   saldo = 0 ⇒ estamos al día
//
// Este es el bug más probable de todo el módulo: cualquiera que venga de leer el ledger de
// clientes va a asumir la convención al revés. Repetirlo en cada lugar que toque este archivo.
class ProveedorCuentaRepository {

    // Inserta un movimiento en el ledger y devuelve {id, saldo}. A diferencia de
    // CuentaCorrienteRepo.RegistrarMovimiento (que solo devuelve el saldo), acá hace falta
    // el insertId para que cajas_movimientos.idProveedorMovimiento pueda apuntar a esta fila
    // (PR 6 — registro de pago).
    //
    // IMPORTANTE: debe llamarse con una connection que ya tiene una transacción abierta por
    // el caller (alta con deuda inicial, registro de pago, etc.) — esta función no abre ni
    // cierra transacción ni libera la connection.
    async RegistrarMovimiento(connection, mov: MovimientoProveedor): Promise<{id:number, saldo:number}> {
        try {
            // Lockeamos la fila del proveedor (no el último movimiento) para serializar los
            // movimientos concurrentes de ese proveedor. Lockear "el último movimiento" falla
            // si el proveedor todavía no tiene ninguno (no hay fila que lockear), dejando una
            // ventana de carrera en el primer movimiento.
            await connection.query('SELECT id FROM proveedores WHERE id = ? FOR UPDATE', [mov.idProveedor]);

            const [ultimo] = await connection.query(
                'SELECT saldo FROM proveedor_cuenta_movimientos WHERE idProveedor = ? ORDER BY id DESC LIMIT 1',
                [mov.idProveedor]
            );

            const saldoAnterior = ultimo.length > 0 ? parseFloat(ultimo[0].saldo) : 0;
            // Number(...) y no solo "?? 0": mysql2 devuelve columnas DECIMAL como string, y
            // un caller podría pasar ese valor sin parsear. saldoAnterior + "150.00" concatena
            // en vez de sumar (ya pasó una vez en cuentaCorrienteRepository).
            const debe = Number(mov.debe ?? 0);
            const haber = Number(mov.haber ?? 0);
            const saldoNuevo = saldoAnterior + debe - haber;

            const ahora = moment();

            const [resultado] = await connection.query(
                `INSERT INTO proveedor_cuenta_movimientos
                    (idProveedor, fecha, hora, tipo, descripcion, comprobante, fechaVencimiento, debe, haber, saldo, idTipoPago, idCaja, idReferencia)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    mov.idProveedor,
                    ahora.format('YYYY-MM-DD'),
                    ahora.format('HH:mm'),
                    mov.tipo,
                    mov.descripcion,
                    mov.comprobante ?? null,
                    mov.fechaVencimiento ?? null,
                    debe,
                    haber,
                    saldoNuevo,
                    mov.idTipoPago ?? null,
                    mov.idCaja ?? null,
                    mov.idReferencia ?? null
                ]
            ) as [ResultSetHeader, any];

            return { id: resultado.insertId, saldo: saldoNuevo };

        } catch (error) {
            throw error;
        }
    }

    async ObtenerSaldo(idProveedor:number): Promise<number> {
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                'SELECT saldo FROM proveedor_cuenta_movimientos WHERE idProveedor = ? ORDER BY id DESC LIMIT 1',
                [idProveedor]
            ) as [any[], any];

            return rows.length > 0 ? parseFloat(rows[0].saldo) : 0;

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Disponible del fondo de proveedores de UNA caja puntual: fondoProveedores (declarado al
    // abrir/editar la caja, PR5) menos lo ya pagado con cargo a esa caja (pagos no anulados).
    // Es el tope real para un EMPLEADO (decisión 2026-08-10, corrige un primer intento con
    // parámetro global): el fondo se define por caja, no una vez para todo el comercio.
    //
    // Devuelve null si la caja no tiene fondo asignado (NULL, no 0 — "no usa el fondo" es un
    // estado distinto de "lo dejó en cero", ver migración de PR5).
    async ObtenerDisponibleFondo(idCaja: number): Promise<number | null> {
        const connection = await db.getConnection();

        try {
            const [cajaRows] = await connection.query(
                'SELECT fondoProveedores FROM cajas WHERE id = ?', [idCaja]
            ) as [any[], any];

            const fondo = cajaRows[0]?.fondoProveedores;
            if (fondo === null || fondo === undefined) return null;

            const [pagadoRows] = await connection.query(
                `SELECT COALESCE(SUM(haber), 0) AS pagado FROM proveedor_cuenta_movimientos
                 WHERE idCaja = ? AND tipo = 'pago' AND anulado = 0`,
                [idCaja]
            ) as [any[], any];

            const pagado = parseFloat(pagadoRows[0]?.pagado ?? 0);
            return parseFloat(fondo) - pagado;

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    async ObtenerMovimientos(filtros:any){
        const connection = await db.getConnection();

        try {
            let { query: queryRegistros, params: paramsRegistros } = ObtenerQueryMovimientos(filtros,false);
            let { query: queryTotal, params: paramsTotal } = ObtenerQueryMovimientos(filtros,true);

            const rows = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);

            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Registra un pago a proveedor. Es el único método de todo el módulo que mueve plata real
    // y toca el arqueo (documentos/handoff_proveedores_fase2.md, PR6) — toda la secuencia va
    // en una sola transacción: si algo falla, no puede quedar un pago en el ledger sin su
    // SALIDA de caja, ni al revés.
    //
    // "comprobante": si viene, primero se registra una 'factura' (debe=monto) y después el
    // 'pago' (haber=monto) — el saldo vuelve al valor que tenía. Es el caso de "contado en el
    // acto" (el proveedor trae la mercadería y le pagan ahí mismo): un solo trámite en vez de
    // dos, y la libreta queda armada sola.
    async RegistrarPago(data:any, usuarioId?:number|string|null, puestoId?:string|null): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const monto = Number(data.monto);
            if (!(monto > 0)) {
                await connection.rollback();
                return "El monto debe ser mayor a 0.";
            }

            const [provRows] = await connection.query(
                'SELECT id, nombre, fechaBaja FROM proveedores WHERE id = ?', [data.idProveedor]
            ) as [any[], any];
            const proveedor = provRows[0];

            if (!proveedor || proveedor.fechaBaja) {
                await connection.rollback();
                return "El proveedor no existe o está dado de baja.";
            }

            // Guard de efectivo en el backend (defensa en profundidad, no confiar solo en la
            // UI): idCaja solo se acepta si el medio de pago es EFECTIVO.
            const idCajaImputada = (Number(data.idTipoPago) === ID_TIPO_PAGO_EFECTIVO && data.idCaja)
                ? Number(data.idCaja)
                : null;

            if (idCajaImputada) {
                const [cajaRows] = await connection.query(
                    'SELECT id, finalizada FROM cajas WHERE id = ?', [idCajaImputada]
                ) as [any[], any];
                const caja = cajaRows[0];

                if (!caja || Number(caja.finalizada) === 1) {
                    await connection.rollback();
                    return "La caja seleccionada no existe o ya fue finalizada.";
                }
            }

            const [tipoPagoRows] = await connection.query(
                'SELECT nombre FROM tipos_pago WHERE id = ?', [data.idTipoPago]
            ) as [any[], any];
            const nombreMedioPago = tipoPagoRows[0]?.nombre ?? 'medio de pago desconocido';

            let idFactura: number | null = null;
            if (data.comprobante) {
                const factura = await this.RegistrarMovimiento(connection, {
                    idProveedor: data.idProveedor,
                    tipo: 'factura',
                    descripcion: 'Compra contado',
                    comprobante: data.comprobante,
                    debe: monto
                });
                idFactura = factura.id;
            }

            let descripcionPago = `Pago a proveedor ${proveedor.nombre} - ${nombreMedioPago}`;
            if (data.comprobante) descripcionPago += ` - comp. ${data.comprobante}`;
            if (data.observacion) descripcionPago += ` - ${data.observacion}`;

            const pago = await this.RegistrarMovimiento(connection, {
                idProveedor: data.idProveedor,
                tipo: 'pago',
                descripcion: descripcionPago,
                haber: monto,
                idTipoPago: Number(data.idTipoPago),
                idCaja: idCajaImputada,
                idReferencia: idFactura
            });

            // Si se imputó a una caja (efectivo), registramos la SALIDA en la misma
            // transacción: atomicidad no negociable.
            if (idCajaImputada) {
                await MovimientosRepo.Agregar({
                    idCaja: idCajaImputada,
                    tipoMovimiento: 'SALIDA',
                    monto,
                    descripcion: `Pago a proveedor ${proveedor.nombre} - mov. #${pago.id}`,
                    idProveedorMovimiento: pago.id
                }, connection);
            }

            await connection.commit();

            await SesionServ.RegistrarMovimiento(
                `Se registró un pago a proveedor ${proveedor.nombre} por $${monto}`, usuarioId, puestoId
            );

            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Anula un pago. Espejo de CuentasCorsRepository.RevertirEstadoPago: nunca borra el
    // movimiento original, lo compensa con un 'ajuste' y marca el original con anulado=1 solo
    // como flag de estado (el saldo de filas históricas no se recalcula nunca — se corrige
    // hacia adelante con el movimiento compensatorio).
    async AnularPago(data:any, usuarioId?:number|string|null, puestoId?:string|null): Promise<string> {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const [movRows] = await connection.query(
                'SELECT id, idProveedor, tipo, haber, anulado FROM proveedor_cuenta_movimientos WHERE id = ?',
                [data.idMovimiento]
            ) as [any[], any];
            const movimiento = movRows[0];

            if (!movimiento) {
                await connection.rollback();
                return "El movimiento no existe.";
            }
            if (movimiento.tipo !== 'pago') {
                await connection.rollback();
                return "Solo se pueden anular movimientos de tipo pago.";
            }
            if (Number(movimiento.anulado) === 1) {
                await connection.rollback();
                return "Este pago ya fue anulado.";
            }

            // Si el pago estaba imputado a una caja, hay que revertir esa SALIDA. Bloqueamos si
            // esa caja ya fue finalizada (mismo criterio que RevertirEntregaDinero/
            // RevertirEstadoPago de clientes, decisión con Nahu 2026-07-23): no se altera el
            // arqueo de una caja ya cerrada, requiere ajuste manual.
            const [cmRows] = await connection.query(
                `SELECT cm.id, cm.idCaja, cm.monto, c.finalizada
                 FROM cajas_movimientos cm
                 INNER JOIN cajas c ON c.id = cm.idCaja
                 WHERE cm.idProveedorMovimiento = ? AND cm.tipoMovimiento = 'SALIDA'`,
                [data.idMovimiento]
            ) as [any[], any];
            const movCaja = cmRows[0];

            if (movCaja && Number(movCaja.finalizada) === 1) {
                await connection.rollback();
                return "No se puede anular: la caja a la que se imputó este pago ya fue finalizada. Requiere un ajuste manual.";
            }

            const ajuste = await this.RegistrarMovimiento(connection, {
                idProveedor: movimiento.idProveedor,
                tipo: 'ajuste',
                descripcion: `Anulación de pago #${movimiento.id}`,
                debe: parseFloat(movimiento.haber),
                idReferencia: movimiento.id
            });

            // Único UPDATE de una fila histórica del ledger: es solo un flag de estado para que
            // la libreta pueda tacharla, el saldo de esa fila no se toca.
            await connection.query(
                'UPDATE proveedor_cuenta_movimientos SET anulado = 1 WHERE id = ?', [movimiento.id]
            );

            // La ENTRADA compensatoria apunta al movimiento de AJUSTE, no al pago original, para
            // mantener la relación 1:1 entre fila de caja y fila de ledger.
            if (movCaja) {
                await MovimientosRepo.Agregar({
                    idCaja: movCaja.idCaja,
                    tipoMovimiento: 'ENTRADA',
                    monto: movCaja.monto,
                    descripcion: `Anulación de pago a proveedor - mov. #${ajuste.id}`,
                    idProveedorMovimiento: ajuste.id
                }, connection);
            }

            await connection.commit();

            await SesionServ.RegistrarMovimiento(
                `Se anuló un pago a proveedor nro ${movimiento.id}`, usuarioId, puestoId
            );

            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

// Con parámetros bindeados (como cuentasCorsRepository.ObtenerQueryMovimientos), no por
// concatenación de valores (a diferencia de movimientosRepository.ObtenerQuery).
function ObtenerQueryMovimientos(filtros:any, esTotal:boolean):{query:string, params:any[]}{
    let paginado:string = "";
    let count:string = "";
    let endCount:string = "";
    let params:any[] = [filtros.idProveedor];

    if (esTotal){
        count = "SELECT COUNT(*) AS total FROM ( ";
        endCount = " ) as subquery";
    } else {
        if (filtros.tamanioPagina != null){
            paginado = " LIMIT ? OFFSET ? ";
            params.push(filtros.tamanioPagina, (filtros.pagina - 1) * filtros.tamanioPagina);
        }
    }

    const query = count +
        " SELECT id, fecha, hora, tipo, descripcion, comprobante, fechaVencimiento, debe, haber, saldo, idTipoPago, idCaja, idReferencia, anulado " +
        " FROM proveedor_cuenta_movimientos " +
        " WHERE idProveedor = ? " +
        " ORDER BY id DESC " +
        paginado +
        endCount;

    return {query, params};
}

export const ProveedorCuentaRepo = new ProveedorCuentaRepository();
