import db from '../db';
import { Cliente } from '../models/Cliente';

class ClientesRepository{

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

    async ObtenerCliente(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);
           
            return new Cliente(rows[0][0]);;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ClientesSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, nombre FROM clientes');
            return [rows][0];

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
            if(existe)//Verificamos si ya existe un cliente con el mismo nombre 
                return "Ya existe un cliente con el mismo nombre.";
            
            const consulta = "INSERT INTO clientes(nombre) VALUES (?)";
            const parametros = [data.nombre.toUpperCase()];
            
            await connection.query(consulta, parametros);
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
            if(existe)//Verificamos si ya existe un cliente con el mismo nombre 
                return "Ya existe un cliente con el mismo nombre.";
            
                const consulta = `UPDATE clientes 
                SET nombre = ?
                WHERE id = ? `;

            const parametros = [data.nombre.toUpperCase(), data.id];
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
            await connection.query("DELETE FROM clientes WHERE id = ?", [id]);
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
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " WHERE c.nombre LIKE '%"+ filtros.busqueda + "%' ";
        if (filtros.idCliente != null && filtros.idCliente != 0) 
            filtro += " WHERE c.id = "+ filtros.idCliente;
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
            " SELECT c.* " +
            " FROM clientes c" +
            filtro +
            " ORDER BY c.id DESC" +
            paginado +
            endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM clientes WHERE nombre = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nombre.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

export const ClientesRepo = new ClientesRepository();





