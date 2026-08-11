import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { Caja } from '../models/Caja';
import { SesionServ } from '../services/sesionService';
const moment = require('moment');

class CajasRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
             //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true);

            //Obtengo la lista de registros y el total
            const [rows] = await connection.query(queryRegistros, paramsRegistros);
            const resultado = await connection.query(queryTotal, paramsTotal);

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
                        fondoProveedores: row['fondoProveedores'],
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

    // Cajas activas (finalizada=0) para el selector de imputación de cobros de fiado.
    // Reusa Obtener/ObtenerQuery (mismo filtro finalizada=0 que ya usa el listado de cajas)
    // y devuelve solo lo que el selector necesita para ser legible con varias cajas abiertas.
    async ObtenerActivas(){
        const { registros } = await this.Obtener({ finalizada: 0 });
        return (registros as Caja[]).map(c => ({
            id: c.id,
            fecha: c.fecha,
            hora: c.hora,
            responsable: c.responsable
        }));
    }

    async ObtenerCaja(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let { query: consulta, params } = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta, params);

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
                fondoProveedores: row['fondoProveedores'],
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
    async Finalizar(data:any, usuarioId?:number|string|null, puestoId?:string|null): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = " UPDATE cajas " +
                             " SET finalizada = ? " +
                             " WHERE id = ?";

            const parametros = [data.finalizada, data.idCaja];

            await connection.query(consulta, parametros);

            //Registramos el Movimiento
            if(data.finalizada == 1)
                await SesionServ.RegistrarMovimiento("Finalizar la caja nro " + data.idCaja, usuarioId, puestoId);
            else
                await SesionServ.RegistrarMovimiento("Revertir la caja nro " + data.idCaja, usuarioId, puestoId);


            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Agregar(data:any, usuarioId?:number|string|null, puestoId?:string|null): Promise<number>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " INSERT INTO cajas(idResponsable, fecha, hora, inicial, ventas, entradas, salidas, finalizada, fondoProveedores) " +
                             " VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)";

            const parametros = [data.responsable.id, moment(data.fecha).format('YYYY-MM-DD'), data.hora, data.inicial, data.ventas, data.entradas, data.salidas, data.finalizada ? 1 : 0, data.fondoProveedores ?? null];

            //id real de AUTO_INCREMENT (antes se "adivinaba" con ObtenerUltimaCaja, sin
            //transacción ni lock — dos cajeros abriendo caja al mismo tiempo podían chocar)
            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            const idCaja = resultado.insertId;

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Agregar Nueva Caja nro " + idCaja, usuarioId, puestoId);

            //Terminamos retornando el id de la caja insertada
            return idCaja;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any, usuarioId?:number|string|null, puestoId?:string|null): Promise<string>{
        const connection = await db.getConnection();
        
        try {
                       
            // fondoProveedores siempre viaja en el payload (con el valor anterior si el flag
            // está apagado o no se tocó): igual que idLista en clientesRepository.Modificar,
            // sin este fallback en el front, modificar cualquier otro campo de la caja le
            // borraría silenciosamente el fondo que ya tenía asignado.
            const consulta = " UPDATE cajas " +
                             " SET idResponsable = ?, " +
                             "     fecha = ?, " +
                             "     inicial = ?, " +
                             "     fondoProveedores = ? " +
                             " WHERE id = ? ";

            const parametros = [data.responsable.id, moment(data.fecha).format('YYYY-MM-DD'), data.inicial, data.fondoProveedores ?? null, data.id];
            await connection.query(consulta, parametros);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Modificar Caja nro " + data.id, usuarioId, puestoId);

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Eliminar(id:string, usuarioId?:number|string|null, puestoId?:string|null): Promise<string>{
        const connection = await db.getConnection();

        try {
            let consulta = " UPDATE cajas " +
                           " SET fechaBaja = ? " +
                           " WHERE id = ?";

            await connection.query(consulta, [new Date(), id]);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Eliminar Caja nro " + id, usuarioId, puestoId);

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
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
        if (filtros.idCaja != null && filtros.idCaja != 0)
            {
                filtro += " AND c.id = ?";
                params.push(filtros.idCaja);
            }
        else
        {
            if (filtros.responsable != null && filtros.responsable != 0){
                filtro += " AND c.idResponsable = ?";
                params.push(filtros.responsable);
            }
            // moment().format('YYYY-MM-DD') siempre devuelve un string fijo (o "Invalid date"),
            // no hay input de usuario libre acá — seguro sin parametrizar.
            if (filtros.inicio != null && filtros.inicio != "") filtro += " AND c.fecha >= '" + moment(filtros.inicio).format('YYYY-MM-DD') + "' ";
            if (filtros.fin != null && filtros.fin != "") filtro += " AND c.fecha <= '" + moment(filtros.fin).format('YYYY-MM-DD') + "' ";

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
            if (filtros.tamanioPagina != null){
                paginado = " LIMIT ? OFFSET ? ";
                params.push(Number(filtros.tamanioPagina), (Number(filtros.pagina) - 1) * Number(filtros.tamanioPagina));
            }
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
        return {query, params};

    } catch (error) {
        throw error;
    }
}

export const CajasRepo = new CajasRepository();





