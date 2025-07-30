import moment from 'moment';
import db from '../db';

class CuentasCorsRepository{
    
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const rows = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerDeudaTotalCliente(idCliente){
        const connection = await db.getConnection();
        
        try {
            const queryDeuda = `SELECT 
                                SUM(d.cantidad * d.precio) AS totalImpagas
                                FROM ventas v
                                INNER JOIN ventas_pago p ON v.id = p.idVenta
                                INNER JOIN ventas_detalle d ON v.id = d.idVenta
                                WHERE v.idCliente = ?
                                AND p.realizado = 0;`
            const rows1 = await connection.query(queryDeuda, [idCliente]);
            const resultado1 = rows1[0][0];

            const queryEntregas = `SELECT SUM(vp.entrega) AS entregaTotal
                                    FROM ventas_pago vp
                                    INNER JOIN ventas v ON v.id = vp.idVenta
                                    WHERE v.idCliente = ? AND vp.realizado = 0;`

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

    async EntregaDinero(data:any): Promise<string>{
        
        const connection = await db.getConnection();

        //Obtenemos el listado de ventas del cliente en estado impagas
        let resultados = await ObtenerVentasImpagas(connection, data.idCliente);

        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el registro de cabecera
            const ultimoRegistro = await ObtenerUltimoRegistroEntrega(connection);
            await connection.query("INSERT INTO ventas_entrega(id,idCliente, monto, fecha) VALUES(?,?,?,?)", 
                [ultimoRegistro, data.idCliente, data.monto, moment(Date.now()).format('YYYY-MM-DD')]);

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
                            [ultimoRegistro, row.id, row.total]
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
                            [ultimoRegistro, row.id, montoRestante]
                        );

                        montoRestante = 0;
                        break;
                    }
                }
            }   

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

    async RevertirEntregaDinero(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

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

            if (data.realizado==0) data.total = 0;  //Si resulta que esta revirtiendo, quitamos la entrega

            const consulta = " UPDATE ventas_pago " +
                             " SET realizado = ?, " +
                             " entrega = ? " +
                             " WHERE idVenta = ?";

            const parametros = [data.realizado, data.total, data.idVenta];
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
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

async function ObtenerUltimoRegistroEntrega(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM ventas_entrega ORDER BY id DESC LIMIT 1 ");
        let resultado:number = 0;

        if([rows][0][0].length==0){
            resultado = 1;
        }else{
            resultado = rows[0][0].id + 1;
        }

        return resultado;

    } catch (error) {
        throw error; 
    }
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        //#region VARIABLES
        let query:string;
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        if (esTotal)
        {//Si esTotal agregamos para obtener un total de la consulta
            count = "SELECT COUNT(*) AS total FROM ( ";
            endCount = " ) as subquery";
        }
        else
        {//De lo contrario paginamos
            if (filtros.tamanioPagina != null)
                paginado = " LIMIT " + filtros.tamanioPagina + " OFFSET " + ((filtros.pagina - 1) * filtros.tamanioPagina);
        }
            
        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
            " SELECT id, fecha, monto " +
            " FROM ventas_entrega  " +
            " WHERE idCliente = " +
            filtros.idCliente +
            " ORDER BY fecha ASC " +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

export const CuentasRepo = new CuentasCorsRepository();