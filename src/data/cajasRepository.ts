import db from '../db';
import { Caja } from '../models/Caja';
const moment = require('moment');

class CajasRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let queryRegistros = await ObtenerQuery(filtros,false);
            let queryTotal = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros);
            const resultado = await connection.query(queryTotal);

            const cajas:Caja[] = [];

            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let caja:Caja = new Caja({
                        id: row['id'],
                        idresponsable: row['idResponsable'],
                        responsable: row['responsable'],
                        fecha: row['fecha'],
                        hora:row['hora'],
                        inicial: row['inicial'],
                        ventas: row['ventas'],
                        entradas: row['entradas'],
                        salidas: row['salidas'],
                        finalizada: row['finalizada'],
                    });
                    

                    cajas.push(caja);
                  }
            }

            return {total:resultado[0][0].total, registros:cajas};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerCaja(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);
           
            const row = rows[0][0];
            let caja:Caja = new Caja({
                id: row['id'],
                idResponsable: row['idResponsable'],
                responsable: row['responsable'],
                fecha: row['fecha'],
                hora:row['hora'],
                inicial: row['inicial'],
                ventas: row['ventas'],
                entradas: row['entradas'],
                salidas: row['salidas'],
                finalizada: row['finalizada'],
            });
            
            return caja;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async Finalizar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " UPDATE cajas " +
                             " SET finalizada = ? " +
                             " WHERE id = ?";
            
            const parametros = [data.finalizada, data.idCaja];
            
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Agregar(data:any): Promise<number>{
        const connection = await db.getConnection();
        
        try {
            let idCaja:number = await ObtenerUltimaCaja(connection);
            
            const consulta = " INSERT INTO cajas(id, idResponsable, fecha, hora, inicial, ventas, entradas, salidas, finalizada) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";
            
            const parametros = [idCaja, data.responsable.id, moment(data.fecha).format('YYYY-MM-DD'), data.hora, data.inicial, data.ventas, data.entradas, data.salidas, data.finalizada ? 1 : 0];
            
            await connection.query(consulta, parametros);

            //Terminamos retornando el id de la caja insertada
            return idCaja;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
                       
            const consulta = " UPDATE cajas " +
                             " SET idResponsable = ?, " +
                             "     fecha = ?, " +
                             "     inicial = ? " +
                             " WHERE id = ? ";
            
            const parametros = [data.responsable.id, moment(data.fecha).format('YYYY-MM-DD'), data.inicial, data.id];
            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(id:string): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            let consulta = " UPDATE cajas " +
                           " SET fechaBaja = ? " +
                           " WHERE id = ?";

            await connection.query(consulta, [new Date(), id]);
            return "OK";

        } catch (error:any) {
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
        if (filtros.idCaja != null && filtros.idCaja != 0)
            {
                filtro += " AND c.id = " + filtros.idCaja;
            }
        else
        {
            if (filtros.responsable != 0) filtro += " AND c.idResponsable = " + filtros.responsable;
            if (filtros.fecha != null) filtro += " AND c.fecha = '" + moment(filtros.fecha).format('YYYY-MM-DD') + "' ";
        
            filtro += (filtros.finalizada) ? " AND c.finalizada = 1 " : " AND c.finalizada = 0 ";
        }
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
                " SELECT c.*, COALESCE(u.nombre, 'ELIMINADO') responsable, SUM(c.inicial + c.ventas + c.entradas - c.salidas) total " +
                " FROM cajas c " +
                " LEFT JOIN usuarios u ON u.id = c.idResponsable " +
                " WHERE c.fechaBaja IS NULL " +
                filtro +
                " GROUP BY c.id " +
                " ORDER BY c.id DESC" +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ObtenerUltimaCaja(connection):Promise<number>{
    try {
        const rows = await connection.query(" SELECT id FROM cajas ORDER BY id DESC LIMIT 1 ");
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

export const CajasRepo = new CajasRepository();





