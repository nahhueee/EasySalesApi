import moment from 'moment';
import bcrypt from 'bcryptjs';
import db from '../db';
import { SesionServ } from '../services/sesionService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { EventosRepo } from './eventosRepository';
import { Auditoria } from '../models/Evento';
import { SIN_AUDITORIA } from '../utils/auditoria';

const BCRYPT_COST = 10;

class UsuariosRepository{

    //#region OBTENER
    async Obtener(filtros:any){
        const connection = await db.getConnection();
        
        try {
            //Obtengo la query segun los filtros
            let { query: queryRegistros, params: paramsRegistros } = await ObtenerQuery(filtros,false,true);
            let { query: queryTotal, params: paramsTotal } = await ObtenerQuery(filtros,true,true);

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
            // Sin filtro de baja: se usa para mostrar datos de usuarios históricos.
            let { query: consulta, params } = await ObtenerQuery(filtros,false,false);
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
                " WHERE u.id = ? AND u.fechaBaja IS NULL ",
                [idUsuario]
            );
            const usuario = (rows as any[])[0];

            // Mismo mensaje genérico exista o no el usuario — no confirmar a un atacante
            // si un id de usuario es válido. Un usuario dado de baja entra por el mismo camino:
            // no se revela que existe pero está de baja (Fase 3.2-C).
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

    // Fase 3.2-C: por defecto solo usuarios activos. Con incluirBajas devuelve también los dados
    // de baja (campo deBaja) para filtrar pantallas históricas, ej. cajas viejas por responsable.
    async UsuariosSelector(incluirBajas:boolean = false){
        const connection = await db.getConnection();

        try {
            // Se agrega idCargo/cargo (mismo JOIN que Login) para que el login pueda
            // distinguir admin/empleado sin una segunda llamada a ObtenerUsuario.
            const consulta =
                " SELECT u.id, u.nombre, u.idCargo, c.nombre cargo" +
                (incluirBajas ? ", (u.fechaBaja IS NOT NULL) AS deBaja" : "") +
                " FROM usuarios u " +
                " LEFT JOIN cargos c on c.id = u.idCargo " +
                (incluirBajas ? " ORDER BY (u.fechaBaja IS NOT NULL), u.id " : " WHERE u.fechaBaja IS NULL ");

            const [rows] = await connection.query(consulta);

            return incluirBajas
                ? (rows as any[]).map(r => ({ ...r, deBaja: !!r.deBaja }))
                : [rows][0];

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
            // Guarda defensiva: varios call sites arman `accion` concatenando texto fijo +
            // datos de negocio sin largo acotado (nombre de cliente, proveedor, usuario,
            // descripción de registro, etc.). Si el resultado supera el ancho de la columna,
            // el INSERT explota y aborta la transacción del caller entera (ver bug 2026-08-05:
            // venta rechazada por "Data too long for column 'accion'" con cliente de nombre largo).
            // Truncamos acá, en el único choke point de escritura, en vez de validar en cada
            // uno de los ~15 call sites — usuarios_movimientos.accion es un log de auditoría,
            // preferimos guardar el mensaje cortado a perder la operación de negocio completa.
            const ACCION_MAX_LEN = 255; // debe coincidir con usuarios_movimientos.accion (ver migración 20260811160000)
            const accionSegura = typeof accion === 'string' && accion.length > ACCION_MAX_LEN
                ? accion.slice(0, ACCION_MAX_LEN)
                : accion;

            // La hora la pone MySQL (architecture.md §11.6), no Node.
            const consulta = "INSERT INTO usuarios_movimientos(fecha, accion, idUsuario, idPuesto) VALUES (NOW(), ?, ?, ?)";
            const parametros = [accionSegura, idUsuario, idPuesto];

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
            //Un usuario dado de baja no se edita (tampoco se reactiva, ver 3.2-C)
            const [activo] = await connection.query<any[]>("SELECT 1 FROM usuarios WHERE id = ? AND fechaBaja IS NULL", [data.id]);
            if(activo.length === 0)
                return "El usuario no existe o fue dado de baja.";

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

    // Fase 3.2-C. Borrado físico solo si el usuario no aparece en ninguna tabla; si aparece en
    // alguna, baja lógica (fechaBaja). La auditoría (usuarios_movimientos, eventos) NUNCA se borra.
    // Devuelve 'OK' (borrado) o 'BAJA' (baja lógica). Lanza AppError NOT_FOUND / ULTIMO_ADMINISTRADOR.
    async Eliminar(id:string, auditoria:Auditoria = SIN_AUDITORIA): Promise<string>{
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // El id del cargo se resuelve por nombre, no se hardcodea.
            const [cargoRows] = await connection.query<any[]>("SELECT id FROM cargos WHERE nombre = 'ADMINISTRADOR' LIMIT 1");
            const idCargoAdmin = cargoRows.length > 0 ? Number(cargoRows[0].id) : null;

            // Se bloquean TODAS las filas de administradores activos (no solo la del usuario):
            // el front elimina varios usuarios en paralelo (forkJoin), y con un lock solo sobre la
            // fila propia dos transacciones eliminando a los dos únicos admins pasarían el guard a
            // la vez. Con este lock la segunda espera y ve el estado ya actualizado.
            const [admins] = idCargoAdmin !== null
                ? await connection.query<any[]>(
                    "SELECT id FROM usuarios WHERE idCargo = ? AND fechaBaja IS NULL FOR UPDATE", [idCargoAdmin])
                : [[] as any[]];

            const [usuarioRows] = await connection.query<any[]>(
                "SELECT id, nombre, idCargo FROM usuarios WHERE id = ? AND fechaBaja IS NULL FOR UPDATE", [id]);
            const usuario = usuarioRows[0];

            if (!usuario) {
                throw new AppError(CodigoError.NOT_FOUND, 'El usuario no existe o ya fue dado de baja.', 404,
                    { modulo: 'usuariosRepository.Eliminar', id });
            }

            // Guard del último administrador activo
            const esAdmin = idCargoAdmin !== null && Number(usuario.idCargo) === idCargoAdmin;
            if (esAdmin && !admins.some(a => Number(a.id) !== Number(usuario.id))) {
                throw new AppError(CodigoError.ULTIMO_ADMINISTRADOR, 'No se puede eliminar al último administrador.', 409,
                    { modulo: 'usuariosRepository.Eliminar', id });
            }

            // Referencias: cualquier tabla donde figure el usuario => baja lógica.
            const [refs] = await connection.query<any[]>(
                `SELECT EXISTS(
                    SELECT 1 FROM usuarios_movimientos WHERE idUsuario = ?
                    UNION ALL
                    SELECT 1 FROM eventos WHERE idUsuario = ?
                    UNION ALL
                    SELECT 1 FROM cajas WHERE idResponsable = ?
                    UNION ALL
                    SELECT 1 FROM presupuestos WHERE idUsuario = ?
                    UNION ALL
                    SELECT 1 FROM presupuestos WHERE idUsuarioModifico = ?
                    UNION ALL
                    SELECT 1 FROM producto_precio_historial WHERE idUsuario = ?
                    UNION ALL
                    SELECT 1 FROM importaciones_costos WHERE idUsuario = ?
                ) AS tieneReferencias`,
                [id, id, id, id, id, id, id]
            );
            const conBaja = !!refs[0].tieneReferencias;

            if (conBaja) {
                await connection.query("UPDATE usuarios SET fechaBaja = NOW() WHERE id = ?", [id]);
            } else {
                await connection.query("DELETE FROM usuarios WHERE id = ?", [id]);
            }

            const textoLegacy = (conBaja ? "Dar de baja usuario " : "Eliminar usuario ") + usuario.nombre + " (nro " + usuario.id + ")";

            //Registramos el Movimiento (log legacy, doble escritura durante la transición)
            await SesionServ.RegistrarMovimiento(textoLegacy, auditoria.usuarioId, auditoria.puestoId);

            await EventosRepo.Registrar(connection, {
                accion: conBaja ? 'USUARIO_BAJA' : 'USUARIO_ELIMINAR',
                entidad: 'usuarios',
                entidadId: Number(usuario.id),
                datosAntes: { nombre: usuario.nombre, idCargo: usuario.idCargo },
                descripcion: textoLegacy,
                auditoria,
            });

            await connection.commit();
            return conBaja ? 'BAJA' : 'OK';

        } catch (error:any) {
            await connection.rollback();
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

async function ObtenerQuery(filtros:any,esTotal:boolean,soloActivos:boolean):Promise<{query:string, params:any[]}>{
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
        // Fase 3.2-C: el ABM lista solo activos; ObtenerUsuario(id) no filtra (datos históricos).
        if (soloActivos) filtro += " AND u.fechaBaja IS NULL ";

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
        // Solo contra activos: se puede crear un "JUAN" nuevo aunque haya uno viejo de baja (3.2-C)
        let consulta = " SELECT * FROM usuarios WHERE nombre = ? AND fechaBaja IS NULL ";
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