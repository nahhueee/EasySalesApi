import db from '../db';

class RegistrosRepository{

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

    async ObtenerRegistro(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let consulta = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta);
           
            return (rows[0][0]);

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
            
            const consulta = "INSERT INTO registros(descripcion,prioridad) VALUES (?,?)";
            const parametros = [data.descripcion.toUpperCase(), data.prioridad];
            
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
            if(existe)//Verificamos si ya existe un registro con la misma desc
                return "Ya existe un registro con la misma descripcion.";
            
                const consulta = `UPDATE registros 
                SET descripcion = ?,
                    prioridad = ?
                WHERE id = ? `;

            const parametros = [data.descripcion.toUpperCase(), data.prioridad, data.id];
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
            await connection.query("DELETE FROM registros WHERE id = ?", [id]);
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
            filtro += " AND r.descripcion LIKE '%"+ filtros.busqueda + "%' ";
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
            " SELECT r.* " +
            " FROM registros r " +
            " WHERE 1 = 1" +
            filtro +
            " ORDER BY r.id DESC " +
            paginado +
            endCount;

        return query;
            
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

export const RegistrosRepo = new RegistrosRepository();