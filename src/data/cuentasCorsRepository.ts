import moment from 'moment';
import db from '../db';
import { SesionServ } from '../services/sesionService';
import { ResultSetHeader } from 'mysql2';
import { CuentaCorrienteRepo } from './cuentaCorrienteRepository';

class CuentasCorsRepository{
    
    async ObtenerDeudaTotalCliente(idCliente){
        const connection = await db.getConnection();
        
        try {
            const queryDeuda = `SELECT
                                SUM(d.cantidad * d.precio) AS totalImpagas
                                FROM ventas v
                                INNER JOIN ventas_pago p ON v.id = p.idVenta
                                INNER JOIN ventas_detalle d ON v.id = d.idVenta
                                WHERE v.idCliente = ?
                                AND p.realizado = 0
                                AND v.fechaBaja IS NULL;`
            const rows1 = await connection.query(queryDeuda, [idCliente]);
            const resultado1 = rows1[0][0];

            const queryEntregas = `SELECT SUM(vp.entrega) AS entregaTotal
                                    FROM ventas_pago vp
                                    INNER JOIN ventas v ON v.id = vp.idVenta
                                    WHERE v.idCliente = ? AND vp.realizado = 0
                                    AND v.fechaBaja IS NULL;`

            const rows2 = await connection.query(queryEntregas, [idCliente]);
            const resultado2 = rows2[0][0];

            const deudaVentas = !resultado1?.totalImpagas ? 0 : resultado1.totalImpagas;
            const totalEntregas = !resultado2?.entregaTotal ? 0 : resultado2.entregaTotal;

            return deudaVentas - totalEntregas;

        } catch (error:any) {
            throw error;
        } finally{
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

    async EntregaDinero(data:any): Promise<string>{
        
        const connection = await db.getConnection();

        //Obtenemos el listado de ventas del cliente en estado impagas
        let resultados = await ObtenerVentasImpagas(connection, data.idCliente);

        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el registro de cabecera
            const [cabecera] = await connection.query<ResultSetHeader>(
                "INSERT INTO ventas_entrega(idCliente, monto, fecha) VALUES(?,?,NOW())",
                [data.idCliente, data.monto]
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

            //Obtenemos idCliente y monto de la entrega original (los necesitamos
            //para el ajuste del ledger antes de borrar la cabecera mas abajo)
            const [entregaRows] = await connection.query(
                "SELECT idCliente, monto FROM ventas_entrega WHERE id = ?",
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

            //Insertamos el idTipoPago
            await connection.query(
                `INSERT INTO ventas_pagos_detalle (idVenta, idTPago, monto) VALUES (?, ?, ?)`,
                [data.idVenta, data.idTPago, data.total]
            );

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

            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Necesitamos idCliente y el monto entregado actual (antes de resetearlo)
            //para el movimiento de ajuste en la cuenta corriente
            const [ventaRows] = await connection.query(
                "SELECT v.idCliente, p.entrega FROM ventas v INNER JOIN ventas_pago p ON v.id = p.idVenta WHERE v.id = ?",
                [idVenta]
            );
            const ventaInfo = (ventaRows as any)[0];

            const consulta = " UPDATE ventas_pago " +
                             " SET realizado = 0, " +
                             " entrega = 0 " +
                             " WHERE idVenta = ?";

            const parametros = [idVenta];
            await connection.query(consulta, parametros);

            //Quitamos los registros de pago
            await connection.query("DELETE FROM ventas_pagos_detalle WHERE idVenta = ?",[idVenta]);

            //Registramos el movimiento (debe) en la cuenta corriente: revertir el pago
            //vuelve a generar la deuda por el monto que se habia marcado como entregado
            if (ventaInfo && parseFloat(ventaInfo.entrega) > 0) {
                await CuentaCorrienteRepo.RegistrarMovimiento(connection, {
                    idCliente: ventaInfo.idCliente,
                    tipo: 'ajuste',
                    descripcion: 'Reversión de pago de venta',
                    debe: parseFloat(ventaInfo.entrega),
                    idReferencia: parseInt(idVenta)
                });
            }

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Se revirtió el estado pago para la venta nro " + idVenta);

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
            "        ELSE NULL END AS esUltimaEntrega " +
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