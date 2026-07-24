import moment from 'moment';
import db from '../db';
import { SesionServ } from '../services/sesionService';
import { ResultSetHeader } from 'mysql2';
import { CuentaCorrienteRepo } from './cuentaCorrienteRepository';
import { MovimientosRepo } from './movimientosRepository';

// tipos_pago.id del medio EFECTIVO. Verificado contra los seeds/backups (script.sql,
// script-bootstrap.sql, respaldos): siempre id=1. El front de entrega-ventas ya hardcodea
// ids de tipos_pago (excluye id=4=TARJETA), así que hardcodear acá es consistente con el
// estilo existente. Riesgo: si se reordena el seed de tipos_pago, esto se rompe en silencio.
const ID_TIPO_PAGO_EFECTIVO = 1;

class CuentasCorsRepository{
    
    async ObtenerDeudaTotalCliente(idCliente){
        // El ledger es la fuente de verdad desde la implementación de libreta completa.
        // El saldo del último movimiento ya acumula ventas, entregas, NCs y ajustes.
        return this.ObtenerSaldoLedger(Number(idCliente));
    }

    // Saldo actual del ledger para un cliente.
    // Retorna el campo "saldo" del último movimiento — que ya incluye todos los
    // debe/haber acumulados. Si el cliente no tiene movimientos en el ledger, retorna 0.
    // Saldo < 0 = favor del cliente; saldo > 0 = deuda.
    async ObtenerSaldoLedger(idCliente: number): Promise<number> {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(
                'SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = ? ORDER BY id DESC LIMIT 1',
                [idCliente]
            );
            const ultimo = (rows as any)[0];
            return ultimo ? Number(ultimo.saldo) : 0;
        } catch (error) {
            throw error;
        } finally {
            connection.release();
        }
    }

    //Devuelve el listado de movimientos de cuenta corriente de un cliente (pantalla de ledger).
    //Hace LEFT JOIN contra ventas/ventas_pago (solo aplica cuando tipo='venta') para poder mostrar
    //el estado real de la venta (pagada/con deuda/anulada) sin duplicar esa lógica en el front.
    async ObtenerMovimientos(filtros:any){
        const connection = await db.getConnection();

        try {
            //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQueryMovimientos(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQueryMovimientos(filtros,true);

            //Obtengo la lista de movimientos y el total
            const rows = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);

            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Cobros de fiado (parciales y pagos completos) relevantes para el resumen de una caja,
    // para la sección "Cobros" (auditabilidad — no altera el total del arqueo, que sigue
    // saliendo de cajas_movimientos vía TotalesXTipoPago/entradas). Distingue:
    //   - "parcial": ventas_entrega (EntregaDinero), idCaja vive en el header.
    //   - "completo": ventas_pagos_detalle (ActualizarEstadoPago) — se identifica por el
    //     ledger (tipo='ajuste', descripcion='Pago manual de venta') y se toma la ÚLTIMA fila
    //     de ventas_pagos_detalle de esa venta (la que insertó ActualizarEstadoPago), porque
    //     esa tabla también recibe filas del pago original de la venta y no tiene un flag
    //     propio que distinga "pago fiado saldado después" de "pago de contado al vender".
    // Fuente de verdad para "qué pasó": cuenta_corriente_movimientos (ledger), no vpd directo.
    //
    // Filtro: (idCaja del cobro = esta caja) OR (fecha del cobro = fecha de apertura de esta
    // caja). El "OR idCaja" es necesario porque una caja puede quedar activa varios días
    // (finalizada=0 no implica "hoy") — un cobro imputado HOY a una caja abierta hace días
    // tiene que aparecer en su resumen aunque la fecha no coincida, porque ya impactó su
    // arqueo (cajas_movimientos/entradas). El filtro por fecha solo cubre el caso "sin
    // asociar/otra caja", como contexto de qué pasó el día que esta caja abrió.
    async ObtenerCobrosCaja(idCaja:number){
        const connection = await db.getConnection();

        try {
            const [cajaRows] = await connection.query("SELECT fecha FROM cajas WHERE id = ?", [idCaja]);
            const fechaCaja = (cajaRows as any)[0]?.fecha;
            if (!fechaCaja) return [];

            const fecha = moment(fechaCaja).format('YYYY-MM-DD');

            const consulta = `
                SELECT 'parcial' AS origen, ccm.hora, cli.nombre AS cliente, ccm.haber AS monto,
                       tp.nombre AS metodo, tp.icono, tp.color, ve.idCaja
                FROM cuenta_corriente_movimientos ccm
                INNER JOIN clientes cli ON cli.id = ccm.idCliente
                INNER JOIN ventas_entrega ve ON ve.id = ccm.idReferencia
                LEFT JOIN tipos_pago tp ON tp.id = (
                    SELECT vpd.idTPago FROM ventas_pagos_detalle vpd
                    WHERE vpd.idEntrega = ve.id ORDER BY vpd.id ASC LIMIT 1
                )
                WHERE ccm.tipo = 'entrega' AND (ve.idCaja = ? OR ccm.fecha = ?)

                UNION ALL

                SELECT 'completo' AS origen, ccm.hora, cli.nombre AS cliente, ccm.haber AS monto,
                       tp.nombre AS metodo, tp.icono, tp.color, vpd.idCaja
                FROM cuenta_corriente_movimientos ccm
                INNER JOIN clientes cli ON cli.id = ccm.idCliente
                INNER JOIN ventas_pagos_detalle vpd ON vpd.id = (
                    SELECT MAX(vpd2.id) FROM ventas_pagos_detalle vpd2 WHERE vpd2.idVenta = ccm.idReferencia
                )
                LEFT JOIN tipos_pago tp ON tp.id = vpd.idTPago
                WHERE ccm.tipo = 'ajuste' AND ccm.descripcion = 'Pago manual de venta'
                      AND (vpd.idCaja = ? OR ccm.fecha = ?)

                ORDER BY hora ASC
            `;

            const [rows] = await connection.query(consulta, [idCaja, fecha, idCaja, fecha]);

            return (rows as any[]).map(r => ({
                origen: r.origen,
                hora: r.hora,
                cliente: r.cliente,
                monto: parseFloat(r.monto),
                metodo: r.metodo,
                icono: r.icono,
                color: r.color,
                asociacion: r.idCaja == null
                    ? 'sin-asociar'
                    : (Number(r.idCaja) === Number(idCaja) ? 'esta-caja' : 'otra-caja'),
                idCajaAsociada: r.idCaja
            }));

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async EntregaDinero(data:any): Promise<string>{

        const connection = await db.getConnection();

        //Obtenemos el listado de ventas del cliente en estado impagas
        let resultados = await ObtenerVentasImpagas(connection, data.idCliente);

        // Guard de efectivo en el backend (defensa en profundidad, no confiar solo en la UI):
        // idCaja solo se acepta si el medio de pago es EFECTIVO. Con cualquier otro medio se
        // fuerza a null aunque venga con valor — los movimientos de caja hoy son solo efectivo.
        const idCajaImputada = (Number(data.idTPago) === ID_TIPO_PAGO_EFECTIVO && data.idCaja)
            ? Number(data.idCaja)
            : null;

        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el registro de cabecera
            const [cabecera] = await connection.query<ResultSetHeader>(
                "INSERT INTO ventas_entrega(idCliente, monto, fecha, idCaja) VALUES(?,?,NOW(),?)",
                [data.idCliente, data.monto, idCajaImputada]
            );
            const idEntrega = cabecera.insertId;

            let montoRestante = data.monto;

            if (Array.isArray(resultados)) {
                for (let i = 0; i < resultados.length; i++) { 
                    const row = resultados[i];
                    const pagoEntrega = parseFloat(row.entrega) ?? 0;
                    const totalAPagar = parseFloat(row.total) - pagoEntrega;

                    if (montoRestante >= totalAPagar) {
                        // Cierra completamente la venta
                        await connection.query(
                            `UPDATE ventas_pago 
                            SET realizado = 1, entrega = ? 
                            WHERE idVenta = ?`,
                            [row.total, row.id]
                        );

                        // Insertamos detalle de la entrega
                        await connection.query(
                            "INSERT INTO ventas_entrega_detalle (idEntrega, idVenta, montoAplicado) VALUES (?, ?, ?)",
                            [idEntrega, row.id, row.total]
                        );

                        //Insertamos metodo de pago de la entrega
                        await connection.query(
                            `INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto, idEntrega)
                            VALUES (?, ?, ?, ?)`,
                            [row.id, data.idTPago, totalAPagar, idEntrega]
                        );

                        montoRestante -= totalAPagar;
                        if (montoRestante === 0) break;
                    } else {
                        // Solo paga parcialmente
                        await connection.query(
                            `UPDATE ventas_pago 
                            SET entrega = ? 
                            WHERE idVenta = ?`,
                            [pagoEntrega + montoRestante, row.id]
                        );

                        // Insertamos detalle de la entrega
                        await connection.query(
                            "INSERT INTO ventas_entrega_detalle (idEntrega, idVenta, montoAplicado) VALUES (?, ?, ?)",
                            [idEntrega, row.id, montoRestante]
                        );

                        //Insertamos metodo de pago de la entrega
                        await connection.query(
                            `INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto, idEntrega)
                            VALUES (?, ?, ?, ?)`,
                            [row.id, data.idTPago, montoRestante, idEntrega]
                        );

                        montoRestante = 0;
                        break;
                    }
                }
            }

            //Registramos el movimiento (haber) en la cuenta corriente del cliente
            await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                idCliente: data.idCliente,
                tipo: 'entrega',
                descripcion: 'Entrega de dinero',
                haber: data.monto,
                idReferencia: idEntrega
            });

            //Si se imputó a una caja (efectivo), registramos la ENTRADA en la misma transacción:
            //atomicidad no negociable, si esto falla se revierte todo el cobro.
            if (idCajaImputada) {
                await MovimientosRepo.Agregar({
                    idCaja: idCajaImputada,
                    tipoMovimiento: 'ENTRADA',
                    monto: data.monto,
                    descripcion: `Cobro fiado - cliente ${data.idCliente} - entrega #${idEntrega}`,
                    idEntrega: idEntrega
                }, connection);
            }

            //Mandamos la transaccion
            await connection.commit();

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Nueva entrega de dinero al cliente: " + data.idCliente);

            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async RevertirEntregaDinero(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Obtenemos idCliente, monto e idCaja de la entrega original (los necesitamos
            //para el ajuste del ledger y para revertir el movimiento de caja antes de
            //borrar la cabecera mas abajo)
            const [entregaRows] = await connection.query(
                "SELECT idCliente, monto, idCaja FROM ventas_entrega WHERE id = ?",
                [data.idEntrega]
            );
            const entregaOriginal = (entregaRows as any)[0];

            if (!entregaOriginal) {
                await connection.rollback();
                return "La entrega que intentas revertir ya no existe.";
            }

            //Solo se puede revertir la ÚLTIMA entrega del cliente. Se valida por id
            //(autoincremental) contra la BD, nunca por posición dentro de una lista paginada
            //en el front (ese supuesto fue el causante de un bug en la pantalla de registros vieja).
            const [ultimaRows] = await connection.query(
                "SELECT MAX(id) AS idUltima FROM ventas_entrega WHERE idCliente = ?",
                [entregaOriginal.idCliente]
            );
            const idUltimaEntrega = (ultimaRows as any)[0]?.idUltima;

            if (Number(idUltimaEntrega) !== Number(data.idEntrega)) {
                await connection.rollback();
                return "Solo se puede revertir la última entrega registrada para este cliente.";
            }

            //Si el cobro estaba imputado a una caja, revertimos el movimiento de ENTRADA.
            //Bloqueamos la reversión si esa caja ya fue finalizada (decisión con Nahu,
            //2026-07-23): no se altera el arqueo de una caja ya cerrada, requiere ajuste manual.
            if (entregaOriginal.idCaja) {
                const [movRows] = await connection.query(
                    `SELECT cm.id, cm.idCaja, cm.monto, cm.tipoMovimiento, c.finalizada
                     FROM cajas_movimientos cm
                     INNER JOIN cajas c ON c.id = cm.idCaja
                     WHERE cm.idEntrega = ? AND cm.tipoMovimiento = 'ENTRADA'`,
                    [data.idEntrega]
                );
                const movimiento = (movRows as any)[0];

                if (movimiento) {
                    if (Number(movimiento.finalizada) === 1) {
                        await connection.rollback();
                        return "No se puede revertir: la caja a la que se imputó este cobro ya fue finalizada. Requiere un ajuste manual.";
                    }

                    // No se borra la ENTRADA original: se compensa con una SALIDA por el mismo
                    // monto, para preservar la trazabilidad (queda el rastro de que hubo un
                    // cobro y de que se revirtió). El neto en cajas.entradas/salidas da igual
                    // que si nunca hubiera pasado.
                    await MovimientosRepo.Agregar({
                        idCaja: movimiento.idCaja,
                        tipoMovimiento: 'SALIDA',
                        monto: movimiento.monto,
                        descripcion: `Reversión de cobro fiado - entrega #${data.idEntrega}`,
                        idEntrega: data.idEntrega
                    }, connection);
                }
            }

            //Obtenemos los detalles de la entrega
            const consulta = " SELECT idVenta, montoAplicado FROM ventas_entrega_detalle WHERE idEntrega = ? ";
            const [detalles] = await connection.query(consulta, [data.idEntrega])

            if (Array.isArray(detalles)) {
                for (let i = 0; i < detalles.length; i++) { 
                    const row = detalles[i];

                    //Obtengo el pago de la venta
                    const [ventaPago] = await connection.query("SELECT entrega, realizado FROM ventas_pago WHERE idVenta = ?",[row['idVenta']]);

                    //Obtengo el nuevo monto entrega
                    const pagoActual = (ventaPago as any)[0];
                    let nuevoMonto = pagoActual.entrega - parseFloat(row['montoAplicado']);

                    //Actualizo el pago de la venta
                    await connection.query(
                        "UPDATE ventas_pago SET entrega = ?, realizado = ? WHERE idVenta = ?",
                        [nuevoMonto, 0, [row['idVenta']]]
                    );
                }
            }

            //Eliminamos el detalle y cabecera de la entrega revertida
            await connection.query("DELETE FROM ventas_entrega_detalle WHERE idEntrega = ?", [data.idEntrega]);
            await connection.query("DELETE FROM ventas_entrega WHERE id = ?", [data.idEntrega]);
            await connection.query("DELETE FROM ventas_pagos_detalle WHERE idEntrega = ?",[data.idEntrega]);

            //Registramos el movimiento (debe) en la cuenta corriente: revertir una
            //entrega es lo inverso de cobrarla, vuelve a generar la deuda original
            if (entregaOriginal) {
                await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                    idCliente: entregaOriginal.idCliente,
                    tipo: 'ajuste',
                    descripcion: 'Reversión de entrega de dinero',
                    debe: parseFloat(entregaOriginal.monto),
                    idReferencia: data.idEntrega
                });
            }

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Reversión de entrega de dinero nro: " + data.idEntrega);

            //Mandamos la transaccion
            await connection.commit();

            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarEstadoPago(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Necesitamos idCliente para el movimiento en la cuenta corriente
            const [ventaRows] = await connection.query("SELECT idCliente FROM ventas WHERE id = ?", [data.idVenta]);
            const idCliente = (ventaRows as any)[0]?.idCliente;

            const consulta = " UPDATE ventas_pago " +
                             " SET realizado = 1, " +
                             " entrega = monto " +
                             " WHERE idVenta = ?";

            const parametros = [data.idVenta];
            await connection.query(consulta, parametros);

            // Guard de efectivo en el backend (defensa en profundidad, no confiar solo en la UI):
            // idCaja solo se acepta si el medio de pago es EFECTIVO.
            const idCajaImputada = (Number(data.idTPago) === ID_TIPO_PAGO_EFECTIVO && data.idCaja)
                ? Number(data.idCaja)
                : null;

            //Insertamos el idTipoPago
            const [detalle] = await connection.query<ResultSetHeader>(
                `INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto, idCaja) VALUES (?, ?, ?, ?)`,
                [data.idVenta, data.idTPago, data.total, idCajaImputada]
            );
            const idVentaPagoDetalle = detalle.insertId;

            //Registramos el movimiento (haber) en la cuenta corriente del cliente
            if (idCliente) {
                await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                    idCliente: idCliente,
                    tipo: 'ajuste',
                    descripcion: 'Pago manual de venta',
                    haber: data.total,
                    idReferencia: data.idVenta
                });
            }

            //Si se imputó a una caja (efectivo), registramos la ENTRADA en la misma transacción.
            if (idCajaImputada) {
                await MovimientosRepo.Agregar({
                    idCaja: idCajaImputada,
                    tipoMovimiento: 'ENTRADA',
                    monto: data.total,
                    descripcion: `Cobro fiado (pago completo) - cliente ${idCliente} - venta #${data.idVenta}`,
                    idVentaPagoDetalle: idVentaPagoDetalle
                }, connection);
            }

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Se marcó como pago la venta nro " + data.idVenta);

            //Mandamos la transaccion
            await connection.commit();

            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }

    async RevertirEstadoPago(idVenta:string): Promise<string>{
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            // Leer método de pago ANTES de borrar ventas_pagos_detalle.
            // El método importa para saber qué entrada del ledger revertir:
            //   - SAF:   Agregar solo posteó debe=total (SAF no genera haber).
            //            Revertir = haber=totalVenta para cancelar ese debe.
            //   - Otros: Agregar posteó haber=entrega.
            //            Revertir = debe=entrega para cancelar ese haber.
            const [ventaRows] = await connection.query(
                `SELECT v.idCliente, v.total AS totalVenta, p.entrega,
                        tp.nombre AS metodoPago, vpd.id AS idVentaPagoDetalle, vpd.idCaja
                 FROM ventas v
                 INNER JOIN ventas_pago p ON v.id = p.idVenta
                 LEFT JOIN ventas_pagos_detalle vpd ON vpd.idVenta = v.id
                 LEFT JOIN tipos_pago tp ON tp.id = vpd.idTPago
                 WHERE v.id = ?
                 LIMIT 1`,
                [idVenta]
            );
            const ventaInfo = (ventaRows as any)[0];

            //Si el pago estaba imputado a una caja, revertimos el movimiento de ENTRADA
            //ANTES de borrar ventas_pagos_detalle (FK cajas_movimientos.idVentaPagoDetalle).
            //Mismo bloqueo que en RevertirEntregaDinero si la caja ya fue finalizada.
            if (ventaInfo?.idCaja) {
                const [movRows] = await connection.query(
                    `SELECT cm.id, cm.idCaja, cm.monto, cm.tipoMovimiento, c.finalizada
                     FROM cajas_movimientos cm
                     INNER JOIN cajas c ON c.id = cm.idCaja
                     WHERE cm.idVentaPagoDetalle = ? AND cm.tipoMovimiento = 'ENTRADA'`,
                    [ventaInfo.idVentaPagoDetalle]
                );
                const movimiento = (movRows as any)[0];

                if (movimiento) {
                    if (Number(movimiento.finalizada) === 1) {
                        await connection.rollback();
                        return "No se puede revertir: la caja a la que se imputó este cobro ya fue finalizada. Requiere un ajuste manual.";
                    }

                    // Mismo criterio que en RevertirEntregaDinero: se compensa con SALIDA,
                    // no se borra la ENTRADA original.
                    await MovimientosRepo.Agregar({
                        idCaja: movimiento.idCaja,
                        tipoMovimiento: 'SALIDA',
                        monto: movimiento.monto,
                        descripcion: `Reversión de cobro fiado (pago completo) - venta #${idVenta}`,
                        idVentaPagoDetalle: ventaInfo.idVentaPagoDetalle
                    }, connection);
                }
            }

            await connection.query(
                "UPDATE ventas_pago SET realizado = 0, entrega = 0 WHERE idVenta = ?",
                [idVenta]
            );
            await connection.query("DELETE FROM ventas_pagos_detalle WHERE idVenta = ?", [idVenta]);

            if (ventaInfo) {
                const esSAF = (ventaInfo.metodoPago ?? '').toUpperCase() === 'SALDO A FAVOR';
                const totalVenta = parseFloat(ventaInfo.totalVenta ?? 0);
                const entrega   = parseFloat(ventaInfo.entrega   ?? 0);

                if (esSAF && totalVenta > 0) {
                    // SAF: cancelar el debe que Agregar posteó → devuelve el crédito al cliente
                    await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                        idCliente: ventaInfo.idCliente,
                        tipo: 'ajuste',
                        descripcion: 'Reversión de pago (SAF)',
                        haber: totalVenta,
                        idReferencia: parseInt(idVenta)
                    });
                } else if (!esSAF && entrega > 0) {
                    // Otros medios: cancelar el haber que Agregar posteó → restaura la deuda
                    await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                        idCliente: ventaInfo.idCliente,
                        tipo: 'ajuste',
                        descripcion: 'Reversión de pago de venta',
                        debe: entrega,
                        idReferencia: parseInt(idVenta)
                    });
                }
            }

            await SesionServ.RegistrarMovimiento("Se revirtió el estado pago para la venta nro " + idVenta);
            await connection.commit();
            return "OK";

        } catch (error:any) {
            await connection.rollback();
            throw error;
        } finally{
            connection.release();
        }
    }
}

async function ObtenerVentasImpagas(connection, idCliente:number){
    try {
        const consulta = " SELECT v.id, SUM(d.cantidad * d.precio) AS total, p.entrega " +
                         " FROM ventas v " +
                         " INNER JOIN ventas_pago p ON v.id = p.idVenta " +
                         " INNER JOIN ventas_detalle d ON v.id = d.idVenta " +
                         " WHERE v.idCliente = ? AND p.realizado = 0 " +
                         " GROUP BY v.id, v.fecha " +
                         " ORDER BY v.fecha ASC ";

        const [rows] = await connection.query(consulta, [idCliente])
        return [rows][0];

    } catch (error) {
        throw error; 
    }
}

async function ObtenerQueryMovimientos(filtros:any,esTotal:boolean):Promise<{query:string, params:any[]}>{
    try {
        //#region VARIABLES
        let query:string;
        let paginado:string = "";
        let filtroPendientes:string = "";

        let count:string = "";
        let endCount:string = "";
        let params:any[] = [filtros.idCliente];
        //#endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null){
                paginado = " LIMIT ? OFFSET ? ";
                params.push(filtros.tamanioPagina, (filtros.pagina - 1) * filtros.tamanioPagina);
            }
        }

        //Vista "Pendientes": solo ventas a crédito sin saldar y sin anular.
        //El resto de los tipos de movimiento (entrega, ajuste, nota_credito, apertura)
        //solo se muestran en "Todo el historial".
        if (filtros.soloPendientes){
            filtroPendientes = " AND cc.tipo = 'venta' AND vp.realizado = 0 AND v.fechaBaja IS NULL ";
        }

        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
            " SELECT " +
            "   cc.id, cc.fecha, cc.hora, cc.tipo, cc.descripcion, " +
            "   cc.debe, cc.haber, cc.saldo, cc.idReferencia, " +
            "   v.total AS ventaTotal, v.fechaBaja AS ventaFechaBaja, " +
            "   vp.entrega AS ventaEntrega, vp.realizado AS ventaRealizado, " +
            "   CASE WHEN cc.tipo = 'entrega' " +
            "        THEN cc.idReferencia = (SELECT MAX(ve.id) FROM ventas_entrega ve WHERE ve.idCliente = cc.idCliente) " +
            "        ELSE NULL END AS esUltimaEntrega, " +
            "   CASE WHEN cc.tipo = 'venta' " +
            "        THEN EXISTS(SELECT 1 FROM notas_credito nc WHERE nc.idVenta = cc.idReferencia) " +
            "        ELSE 0 END AS tieneNC, " +
            "   CASE WHEN cc.tipo = 'venta' " +
            "        THEN EXISTS(SELECT 1 FROM ventas_factura vf WHERE vf.idVenta = cc.idReferencia) " +
            "        ELSE 0 END AS tieneFactura " +
            " FROM cuenta_corriente_movimientos cc " +
            " LEFT JOIN ventas v ON cc.tipo = 'venta' AND v.id = cc.idReferencia " +
            " LEFT JOIN ventas_pago vp ON vp.idVenta = v.id " +
            " WHERE cc.idCliente = ? " +
            filtroPendientes +
            " ORDER BY cc.fecha DESC, cc.id DESC " +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

export const CuentasRepo = new CuentasCorsRepository();