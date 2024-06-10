import db from '../db';

class MovimientosRepository{

    //#region OBTENER
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
    //#endregion

    //#region ABM
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();
        console.log(data)
        try {
            //Iniciamos una transaccion
            await connection.beginTransaction();

            //Insertamos el movimiento
            const consulta = " INSERT INTO cajas_movimientos(idCaja,tipoMovimiento,monto,descripcion) " +
                             " VALUES(?, ?, ?, ?) ";
            const parametros = [data.idCaja, data.tipoMovimiento.toUpperCase(), data.monto, data.descripcion];
            await connection.query(consulta, parametros);


            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await connection.query("UPDATE cajas SET entradas = entradas + ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await connection.query("UPDATE cajas SET salidas = salidas + ? WHERE id = ?", [data.monto, data.idCaja]);

            
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

    async Eliminar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            //Eliminamos el movimiento
            await connection.query("DELETE FROM cajas_movimientos WHERE id = ?", [data.id]);

            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await connection.query("UPDATE cajas SET entradas = entradas - ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await connection.query("UPDATE cajas SET salidas = salidas - ? WHERE id = ?", [data.monto, data.idCaja]);
            
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
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<string>{
    try {
        
        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        filtro = " WHERE idCaja = " + filtros.caja;

        if (filtros.tipoMovimiento != 0)
            filtro += " AND tipoMovimiento = " + (filtros.tipoMovimiento == 1 ? "'ENTRADA'" : "'SALIDA'");
        // #endregion

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
                " SELECT * " +
                " FROM cajas_movimientos " +
                filtro +
                " ORDER BY id " +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

export const MovimientosRepo = new MovimientosRepository();