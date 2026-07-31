import moment from 'moment';
import bcrypt from 'bcryptjs';
import db from '../db';
import { SesionServ } from '../services/sesionService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

const BCRYPT_COST = 10;

class UsuariosRepository{

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

    async ObtenerUsuario(filtros:any){
        const connection = await db.getConnection();

        try {
            let { query: consulta, params } = await ObtenerQuery(filtros,false);
            const rows = await connection.query(consulta, params);

            return rows[0][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    // Login (Lote 2, Fase 2): reemplaza la comparación en el navegador que hacía
    // login.component.ts contra la password en texto plano que el backend entregaba.
    // La comparación pasa a ser server-side con bcrypt.compare; el hash nunca sale de acá.
    async Login(idUsuario:string, pass:string){
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query(
                " SELECT u.id, u.nombre, u.email, u.pass, u.idCargo, c.nombre cargo " +
                " FROM usuarios u " +
                " LEFT JOIN cargos c on c.id = u.idCargo " +
                " WHERE u.id = ? ",
                [idUsuario]
            );
            const usuario = (rows as any[])[0];

            // Mismo mensaje genérico exista o no el usuario — no confirmar a un atacante
            // si un id de usuario es válido.
            const credencialesInvalidas = () => new AppError(
                CodigoError.LOGIN_INVALIDO,
                'Usuario o contraseña incorrecta.',
                401,
                { modulo: 'usuariosRepository.Login' }
            );

            if (!usuario || !usuario.pass) throw credencialesInvalidas();

            const valido = await bcrypt.compare(pass, usuario.pass);
            if (!valido) throw credencialesInvalidas();

            delete usuario.pass;
            return usuario;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async UsuariosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, nombre FROM usuarios');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async CargosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, nombre FROM cargos');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

     async ObtenerMovimientos(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQueryMovimientos(filtros,false);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQueryMovimientos(filtros,true);

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
    // idPuesto: máquina física (UUID persistido por el front), no confundir con "terminal"
    // (la instalación completa). Ver utils/auditoria.ts y handoff_pr1_identidad_puesto.md.
    async RegistrarMovimiento(accion, idUsuario, idPuesto:string|null = null): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = "INSERT INTO usuarios_movimientos(fecha, accion, idUsuario, idPuesto) VALUES (?, ?, ?, ?)";
            const parametros = [moment().format('YYYY-MM-DD HH:mm:ss'), accion, idUsuario, idPuesto];

            await connection.query(consulta, parametros);
            return "OK";

        }catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe un usuario con el mismo nombre o correo
                return "Ya existe un usuario con el mismo nombre o correo.";

            //Los EMPLEADO no llevan contraseña (decisión de producto, ver handoff Lote 2) —
            //solo hasheamos si vino algo. bcrypt.hash("") es válido pero no queremos
            //consagrar una password vacía hasheada.
            const passGuardar = data.pass ? await bcrypt.hash(data.pass, BCRYPT_COST) : data.pass;

            const consulta = "INSERT INTO usuarios(nombre, email, pass, idCargo) VALUES (?, ?, ?, ?)";
            const parametros = [data.nombre.toUpperCase(), data.email, passGuardar, data.cargo.id];

            await connection.query(consulta, parametros);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Agregar Usuario: " + data.nombre.toUpperCase());

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

            if(existe)//Verificamos si ya existe un usuario con el mismo nombre o correo
                return "Ya existe un usuario con el mismo nombre o correo.";

            //Si data.pass viene vacío, el admin no quiere cambiar la contraseña (el front ya
            //no la precarga porque el backend no la devuelve más) — no tocar la columna, o
            //un UPDATE con pass='' pisaría el hash existente y nadie vuelve a entrar.
            const cambiarPass = !!data.pass;
            const setPass = cambiarPass ? ", pass = ? " : "";

            const consulta = `UPDATE usuarios
                              SET nombre = ?,
                              email = ?
                              ${setPass},
                              idCargo = ?
                              WHERE id = ? `;

            const parametros = cambiarPass
                ? [data.nombre.toUpperCase(), data.email, await bcrypt.hash(data.pass, BCRYPT_COST), data.cargo.id, data.id]
                : [data.nombre.toUpperCase(), data.email, data.cargo.id, data.id];

            await connection.query(consulta, parametros);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Modificar Usuario: " + data.nombre.toUpperCase());

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
            await connection.query("DELETE FROM usuarios_movimientos WHERE idUsuario = ?", [id]);
            await connection.query("DELETE FROM usuarios WHERE id = ?", [id]);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Eliminar Usuario");

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

async function ObtenerQueryMovimientos(filtros:any,esTotal:boolean):Promise<{query:string, params:any[]}>{
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
        if(filtros.idUsuario != null && filtros.idUsuario != 0){
            filtro += " AND um.idUsuario = ?";
            params.push(filtros.idUsuario);
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
            " SELECT um.*, u.nombre, c.nombre cargo" +
            " FROM usuarios_movimientos um " +
            " LEFT JOIN usuarios u on u.id = um.idUsuario " +
            " LEFT JOIN cargos c on c.id = u.idCargo " +
            " WHERE 1 = 1 " +
            filtro +
            " ORDER BY um.fecha DESC" +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
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
            filtro += " AND u.nombre LIKE ? ";
            params.push("%" + filtros.busqueda + "%");
        }

        if(filtros.usuario != null && filtros.usuario != 0){
            filtro += " AND u.id = ?";
            params.push(filtros.usuario);
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
        //Columnas explícitas (no u.*): pass nunca sale en ninguna respuesta del backend
        //(Lote 2, Fase 2 — ver documentos/handoff_fase2_correcciones.md).
        query = count +
            " SELECT u.id, u.nombre, u.email, u.idCargo, c.nombre cargo " +
            " FROM usuarios u " +
            " LEFT JOIN cargos c on c.id = u.idCargo " +
            " WHERE 1 = 1 " +
            filtro +
            " ORDER BY u.id DESC" +
            paginado +
            endCount;

        return {query, params};

    } catch (error) {
        throw error;
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT * FROM usuarios WHERE nombre = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nombre.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

export const UsuariosRepo = new UsuariosRepository();