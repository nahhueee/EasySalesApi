import moment from 'moment';
import db from '../db';
import { ResultSetHeader } from 'mysql2';
import { RegistroDetalle } from '../models/DetalleRegistro';
import { Registro } from '../models/Registro';
import { SesionServ } from '../services/sesionService';

class RegistrosRepository{

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

            const registros:Registro[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let reg:Registro = new Registro();
                    reg.id = row['id'];
                    reg.descripcion = row['descripcion'];
                    reg.prioridad = row['prioridad'];
                    reg.total = parseFloat(row['total']);
                    registros.push(reg);
                }
            }
            return {total:resultado[0][0].total, registros};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerRegistro(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let { query: consulta, params } = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta, params);
           
            const row = rows[0][0];
            let registro:Registro = new Registro({
                id: row['id'],
                descripcion: row['descripcion'],
                total: parseFloat(row['total']),
                prioridad: row['prioridad'],
                detalles: await ObtenerDetalleRegistro(connection, row['id'])
            });
            
            return registro;
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
        
        try {

            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe un registro con la misma desc
                return "Ya existe un registro con la misma descripcion.";

            //Iniciamos una transaccion
            await connection.beginTransaction();

            const consulta = "INSERT INTO registros(descripcion,prioridad,total) VALUES (?,?,?)";
            const parametros = [data.descripcion.toUpperCase(), data.prioridad, data.total];

            //id real de AUTO_INCREMENT (antes se "adivinaba" con ObtenerUltimoRegistro,
            //que con dos altas concurrentes podía linkear los detalles al id equivocado)
            const [resultado] = await connection.query<ResultSetHeader>(consulta, parametros);
            data.id = resultado.insertId;

            //eliminamos los registros
            await connection.query('DELETE FROM registros_detalle WHERE idRegistro = ?', [data.id]);
            //Insertamos los detalles del registro
            for (const element of  data.detalles) {
                element.idRegistro = data.id;
                await InsertDetalleRegistro(connection, element);
            };

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Crear nuevo registro: " + data.descripcion.toUpperCase());

            //Mandamos la transaccion
            await connection.commit();
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Modificar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            let existe = await ValidarExistencia(connection, data, true);
            if(existe)//Verificamos si ya existe un registro con la misma desc
                return "Ya existe un registro con la misma descripcion.";

            //Iniciamos una transaccion
            await connection.beginTransaction();
            
            const consulta = `UPDATE registros 
                SET descripcion = ?,
                    prioridad = ?,
                    total = ?
                WHERE id = ? `;

            const parametros = [data.descripcion.toUpperCase(), data.prioridad, data.total, data.id];
            await connection.query(consulta, parametros);

            //eliminamos los registros
            await connection.query('DELETE FROM registros_detalle WHERE idRegistro = ?', [data.id]);
            
            //Insertamos los detalles del registro
            for (const element of  data.detalles) {
                element.idRegistro = data.id;
                await InsertDetalleRegistro(connection, element);
            };

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Modificar registro: " + data.descripcion.toUpperCase());

            //Mandamos la transaccion
            await connection.commit();
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
            await connection.query("DELETE FROM registros_detalle WHERE idRegistro = ?", [id]);
            await connection.query("DELETE FROM registros WHERE id = ?", [id]);
            await SesionServ.RegistrarMovimiento("Eliminar registro nro " + id);

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
        if (filtros.busqueda != null && filtros.busqueda != ""){
            filtro += " AND r.descripcion LIKE ? ";
            params.push("%" + filtros.busqueda + "%");
        }
        if (filtros.idRegistro != null && filtros.idRegistro != ""){
            filtro += " AND r.id = ?";
            params.push(filtros.idRegistro);
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
            " SELECT r.* " +
            " FROM registros r " +
            " WHERE 1 = 1" +
            filtro +
            " ORDER BY r.prioridad ASC " +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM registros WHERE descripcion = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.descripcion.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

async function ObtenerDetalleRegistro(connection, idRegistro:number){
    try {
        const consulta = " SELECT * FROM registros_detalle WHERE idRegistro = ?" +
                         " ORDER BY id ASC "; 

        const [rows] = await connection.query(consulta, [idRegistro]);

        const detalles:RegistroDetalle[] = [];

        if (Array.isArray(rows)) {
            for (let i = 0; i < rows.length; i++) { 
                const row = rows[i];
                
                let detalle:RegistroDetalle = new RegistroDetalle();
                detalle.id = row['id'];
                detalle.fecha = row['fecha'];
                detalle.accion = row['accion'];
                detalle.monto = parseFloat(row['monto']);
                detalle.observacion = row['observacion'];

                detalles.push(detalle)
              }
        }

        return detalles;

    } catch (error) {
        throw error; 
    }
}
async function InsertDetalleRegistro(connection, detalle):Promise<void>{
    try {
        const consulta = " INSERT INTO registros_detalle(idRegistro, accion, monto, observacion, fecha) " +
                        " VALUES(?, ?, ?, ?, ?) ";

        const parametros = [detalle.idRegistro, detalle.accion, detalle.monto, detalle.observacion, moment(detalle.fecha).format('YYYY-MM-DD')];
        await connection.query(consulta, parametros);
        
    } catch (error) {
        throw error; 
    }
}


export const RegistrosRepo = new RegistrosRepository();