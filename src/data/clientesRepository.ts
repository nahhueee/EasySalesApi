import db from '../db';
import { Cliente } from '../models/Cliente';
import { SesionServ } from '../services/sesionService';
import { ValidarConsistenciaFiscal } from '../utils/datosFiscales';

class ClientesRepository{

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

    async ObtenerCliente(filtros:any){
        const connection = await db.getConnection();
        
        try {
            let { query: consulta, params } = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta, params);
           
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
            const [rows] = await connection.query('SELECT id, nombre, razonSocial, tipoDocumento, nroDocumento, condicionIva, direccion, idLista FROM clientes WHERE fechaBaja IS NULL');
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
            let errorFiscal = ValidarConsistenciaFiscal(data);
            if(errorFiscal) return errorFiscal;

            let existeNombre = await ValidarExistenciaNombre(connection, data, false);
            if(existeNombre)//Verificamos si ya existe un cliente con el mismo nombre
                return "Ya existe un cliente con el mismo nombre.";

            if(data.nroDocumento){//Solo validamos unicidad si vino un documento (consumidor final puede no tenerlo)
                let existeDocumento = await ValidarExistenciaDocumento(connection, data, false);
                if(existeDocumento)
                    return "Ya existe un cliente con el mismo documento.";
            }

            const consulta = "INSERT INTO clientes(nombre, tipoDocumento, nroDocumento, condicionIva, razonSocial, direccion, idLista) VALUES (?, ?, ?, ?, ?, ?, ?)";
            const parametros = [
                data.nombre.toUpperCase(),
                data.tipoDocumento ?? null,
                data.nroDocumento ?? null,
                data.condicionIva ?? null,
                data.razonSocial ? data.razonSocial.toUpperCase() : null,
                data.direccion ? data.direccion.toUpperCase() : null,
                data.idLista ?? null
            ];

            await connection.query(consulta, parametros);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Agregar Nuevo Cliente: " + data.nombre.toUpperCase());

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
            let errorFiscal = ValidarConsistenciaFiscal(data);
            if(errorFiscal) return errorFiscal;

            let existeNombre = await ValidarExistenciaNombre(connection, data, true);
            if(existeNombre)//Verificamos si ya existe un cliente con el mismo nombre
                return "Ya existe un cliente con el mismo nombre.";

            if(data.nroDocumento){//Solo validamos unicidad si vino un documento (consumidor final puede no tenerlo)
                let existeDocumento = await ValidarExistenciaDocumento(connection, data, true);
                if(existeDocumento)
                    return "Ya existe un cliente con el mismo documento.";
            }

                const consulta = `UPDATE clientes
                SET nombre = ?, tipoDocumento = ?, nroDocumento = ?, condicionIva = ?, razonSocial = ?, direccion = ?, idLista = ?
                WHERE id = ? `;

            const parametros = [
                data.nombre.toUpperCase(),
                data.tipoDocumento ?? null,
                data.nroDocumento ?? null,
                data.condicionIva ?? null,
                data.razonSocial ? data.razonSocial.toUpperCase() : null,
                data.direccion ? data.direccion.toUpperCase() : null,
                data.idLista ?? null,
                data.id
            ];
            await connection.query(consulta, parametros);

             //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Modificar Cliente: " + data.nombre.toUpperCase());

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
            // Si el cliente tiene movimientos en CC → baja lógica (preserva auditoría).
            // Si no tiene historial → eliminación física.
            const [movs] = await connection.query<any[]>(
                "SELECT COUNT(*) AS total FROM cuenta_corriente_movimientos WHERE idCliente = ?", [id]
            );

            if (movs[0].total > 0) {
                await connection.query("UPDATE clientes SET fechaBaja = NOW() WHERE id = ?", [id]);
                await SesionServ.RegistrarMovimiento("Dar de baja Cliente nro " + id);
                return "BAJA";
            }

            await connection.query("DELETE FROM clientes WHERE id = ?", [id]);
            await SesionServ.RegistrarMovimiento("Eliminar Cliente nro " + id);
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
        filtro += " WHERE c.fechaBaja IS NULL ";
        if (filtros.busqueda != null && filtros.busqueda != ""){
            filtro += " AND c.nombre LIKE ? ";
            params.push("%" + filtros.busqueda + "%");
        }
        if (filtros.idCliente != null && filtros.idCliente != 0){
            filtro += " AND c.id = ? ";
            params.push(filtros.idCliente);
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
                params.push(filtros.tamanioPagina, (filtros.pagina - 1) * filtros.tamanioPagina);
            }
        }

        const saldoSelect = !esTotal
            ? `, (SELECT saldo FROM cuenta_corriente_movimientos WHERE idCliente = c.id ORDER BY id DESC LIMIT 1) AS saldo`
            : '';

        //Arma la Query con el paginado y los filtros correspondientes
        query = count +
            " SELECT c.* " + saldoSelect +
            " FROM clientes c" +
            filtro +
            " ORDER BY c.id DESC" +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

async function ValidarExistenciaNombre(connection, data:any, modificando:boolean):Promise<boolean>{
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

async function ValidarExistenciaDocumento(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM clientes WHERE nroDocumento = ? AND fechaBaja IS NULL ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nroDocumento, data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error;
    }
}

export const ClientesRepo = new ClientesRepository();





