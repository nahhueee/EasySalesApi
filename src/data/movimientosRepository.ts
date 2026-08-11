import db from '../db';
import { ResultSetHeader } from 'mysql2';

class MovimientosRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const rows = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);
            
            return {total:resultado[0][0].total, registros:rows[0]};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    // Si se pasa "connection" (ya abierta por el caller, dentro de su propia transacción),
    // la reusamos y NO manejamos beginTransaction/commit/rollback/release acá: eso queda
    // a cargo del caller, para poder garantizar atomicidad con otras operaciones (ej. cobro
    // de fiado + movimiento de caja en la misma transacción). Si no se pasa, se comporta
    // igual que antes (conexión y transacción propias).
    async Agregar(data:any, connection?:any): Promise<string>{
        const conexionExterna = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            if(!conexionExterna) await conn.beginTransaction();

            //Insertamos el movimiento
            // idEntrega / idVentaPagoDetalle: referencia opcional al cobro de fiado que originó
            // este movimiento (cobro parcial o pago completo respectivamente), para poder
            // localizarlo y revertirlo con precisión. idProveedorMovimiento: mismo criterio para
            // pagos a proveedores (Fase 2 PR6) — apunta a la fila de proveedor_cuenta_movimientos
            // (pago o su ajuste de anulación). Todos nulos en el uso existente (ABM manual de
            // movimientos de caja).
            const consulta = " INSERT INTO cajas_movimientos(idCaja,tipoMovimiento,monto,descripcion,idEntrega,idVentaPagoDetalle,idProveedorMovimiento) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?) ";
            const parametros = [
                data.idCaja,
                data.tipoMovimiento.toUpperCase(),
                data.monto,
                data.descripcion,
                data.idEntrega ?? null,
                data.idVentaPagoDetalle ?? null,
                data.idProveedorMovimiento ?? null
            ];
            const [resultado] = await conn.query(consulta, parametros) as [ResultSetHeader, any];


            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await conn.query("UPDATE cajas SET entradas = entradas + ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await conn.query("UPDATE cajas SET salidas = salidas + ? WHERE id = ?", [data.monto, data.idCaja]);


            if(!conexionExterna) await conn.commit();
            return conexionExterna ? String(resultado.insertId) : "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            if(!conexionExterna) await conn.rollback();
            throw error;
        } finally{
            if(!conexionExterna) conn.release();
        }
    }

    async Eliminar(data:any, connection?:any): Promise<string>{
        const conexionExterna = !!connection;
        const conn = connection ?? await db.getConnection();

        try {
            if(!conexionExterna) await conn.beginTransaction();

            // Blindaje: un movimiento de caja que vino de un pago a proveedor no se borra desde
            // el ABM manual (eso desincroniza el ledger de proveedores con la caja). Se verifica
            // contra la base, no contra lo que mande el front, porque el front puede tener bugs
            // y la base no puede quedar inconsistente (handoff_proveedores_fase2.md, PR6).
            const [movRows] = await conn.query(
                "SELECT idProveedorMovimiento FROM cajas_movimientos WHERE id = ?", [data.id]
            ) as [any[], any];
            if (movRows[0]?.idProveedorMovimiento != null) {
                if(!conexionExterna) await conn.rollback();
                return "Este movimiento corresponde a un pago a proveedor. Anulalo desde la cuenta del proveedor.";
            }

            //Eliminamos el movimiento
            await conn.query("DELETE FROM cajas_movimientos WHERE id = ?", [data.id]);

            //Actualizamos el monto de la caja
            if(data.tipoMovimiento.toUpperCase() == "ENTRADA")
                await conn.query("UPDATE cajas SET entradas = entradas - ? WHERE id = ?", [data.monto, data.idCaja]);

            if(data.tipoMovimiento.toUpperCase() == "SALIDA")
                await conn.query("UPDATE cajas SET salidas = salidas - ? WHERE id = ?", [data.monto, data.idCaja]);

            if(!conexionExterna) await conn.commit();
            return "OK";

        } catch (error:any) {
            //Si ocurre un error volvemos todo para atras
            if(!conexionExterna) await conn.rollback();
            throw error;
        } finally{
            if(!conexionExterna) conn.release();
        }
    }
    //#endregion
}

async function ObtenerQuery(filtros:any,esTotal:boolean):Promise<{query:string, params:any[]}>{
    try {

        //#region VARIABLES
        let query:string;
        let filtro:string = "";
        let paginado:string = "";

        let count:string = "";
        let endCount:string = "";
        let params:any[] = [];
        //#endregion

        // #region FILTROS
        filtro = " WHERE idCaja = ?";
        params.push(filtros.caja);

        // tipoMovimiento es un enum acotado a 1/otro, mapeado a literales fijos — no hay
        // input de usuario libre en el string, seguro sin parametrizar.
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
            if (filtros.tamanioPagina != null){
                paginado = " LIMIT ? OFFSET ? ";
                params.push(Number(filtros.tamanioPagina), (Number(filtros.pagina) - 1) * Number(filtros.tamanioPagina));
            }
        }

        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
                " SELECT * " +
                " FROM cajas_movimientos " +
                filtro +
                " ORDER BY id " +
                paginado +
                endCount;

        return {query, params};
            
    } catch (error) {
        throw error; 
    }
}

export const MovimientosRepo = new MovimientosRepository();