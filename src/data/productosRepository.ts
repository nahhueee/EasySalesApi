import moment from 'moment';
import db from '../db';
import { Producto } from '../models/Producto';

class ProductosRepository{

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

            const productos:Producto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let producto:Producto = new Producto({
                        id: row['id'],
                        codigo: row['codigo'],
                        nombre: row['nombre'],
                        cantidad: row['cantidad'],
                        costo: row['costo'],
                        precio: row['precio'],
                        tipoPrecio: row['tipoPrecio'],
                        redondeo: row['redondeo'],
                        porcentaje: row['porcentaje'],
                        vencimiento: row['vencimiento'],
                        faltante: row['faltante'],
                        unidad: row['unidad'],
                        imagen: row['imagen'],
                        idCategoria: row['idCategoria'],
                        soloPrecio: row['soloPrecio'],
                    });
                    
                    productos.push(producto);
                  }
            }

            return {total:resultado[0][0].total, registros:productos};

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    //Busca los productos segun lo que digite el usuario
    //en la ventana de nueva venta
    async BuscarProductos(filtro:any){
        const connection = await db.getConnection();

        try {
            let consulta = 'SELECT id, codigo, nombre, costo, precio, unidad FROM productos WHERE id <> 1 AND soloPrecio = 0 ';

            if (filtro.metodo == 'codigo')
                consulta += " AND codigo = '" + filtro.valor + "'";

            if (filtro.metodo == 'nombre')
                consulta += " AND LOWER(nombre) LIKE '%" + filtro.valor + "%'";

            const [rows] = await connection.query(consulta);

            const productos:Producto[] = [];
           
            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) { 
                    const row = rows[i];

                    let producto:Producto = new Producto({
                        id: row['id'],
                        codigo: row['codigo'],
                        nombre: row['nombre'],
                        costo: row['costo'],
                        precio: row['precio'],
                        unidad: row['unidad'],
                    });
                    
                    productos.push(producto);
                  }
            }

            return productos;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerProductosSoloPrecio(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, codigo, nombre FROM productos WHERE soloPrecio = 1');
            return [rows][0];

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerUno(id:number){
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query('SELECT id, codigo, nombre, cantidad, costo, precio, unidad FROM productos WHERE id = ?', [id]);
            let resultado:Producto = new Producto();
           
            if (Array.isArray(rows)) {
                const row = rows[0];

                resultado = new Producto({
                    id: row['id'],
                    codigo: row['codigo'],
                    cantidad: row['cantidad'],
                    nombre: row['nombre'],
                    costo: row['costo'],
                    precio: row['precio'],
                    unidad: row['unidad'],
                });
            }

            return resultado;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion

    //#region ABM
    async ValidarCodigo(data:any){
        const connection = await db.getConnection();
        
        try {
            return await ValidarExistencia(connection, data, false, true);

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            let existe = await ValidarExistencia(connection, data, false, false);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";
            
            const consulta = `INSERT INTO productos(codigo,nombre,cantidad,tipoPrecio,costo,precio,redondeo,porcentaje,faltante,vencimiento,unidad,imagen,soloPrecio)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                data.tipoPrecio,
                                data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.faltante,
                                data.vencimiento ? moment(data.vencimiento).format('YYYY-MM-DD'): null,
                                data.unidad,
                                data.imagen,
                                data.soloPrecio ? 1 : 0];
            
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
            let existe = await ValidarExistencia(connection, data, true, false);
            if(existe)//Verificamos si ya existe un producto con el mismo codigo
                return "Ya existe un producto con el mismo código.";
            
            const consulta = `UPDATE productos SET
                                codigo = ?,
                                nombre = ?,
                                cantidad = ?,
                                tipoPrecio = ?,
                                costo = ?,
                                precio = ?,
                                redondeo = ?,
                                porcentaje = ?,
                                faltante = ?,
                                vencimiento = ?,
                                unidad = ?,
                                imagen = ?,
                                soloPrecio = ?
                                WHERE id = ?`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                data.tipoPrecio,
                                data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.faltante,
                                data.vencimiento ? moment(data.vencimiento).format('YYYY-MM-DD'): null,
                                data.unidad,
                                data.imagen,
                                data.soloPrecio ? 1 : 0,
                                data.id];

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
            await connection.query("DELETE FROM productos WHERE id = ?", [id]);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async AniadirCantidad(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE productos SET
                              cantidad = ?
                              WHERE id = ?`;

            const parametros = [data.cant,data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarFaltante(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE productos SET
                              faltante = ?
                              WHERE id = ?`;

            const parametros = [data.faltante, data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarVencimiento(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE productos SET
                              vencimiento = ?
                              WHERE id = ?`;

            const parametros = [data.vencimiento ? moment(data.vencimiento).format('YYYY-MM-DD'): null, data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }


    async ActualizarImagen(data:any): Promise<string>{
        const connection = await db.getConnection();
        try {
            const consulta = `UPDATE productos SET
                              imagen = ?
                              WHERE id = ?`;

            const parametros = [data.imagen, data.idProducto];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async VerificarYObtener(parametro:any){
        const connection = await db.getConnection();

        try {
            const existe = await ValidarExistencia(connection, {codigo:parametro.cod}, false, false);
            let producto: Producto = new Producto();

            if(existe){
                let consulta = " SELECT id, codigo, nombre, cantidad, tipoPrecio, costo, precio, redondeo, porcentaje, vencimiento, faltante, unidad, imagen, soloPrecio " +
                               " FROM productos WHERE codigo = ? ";
                
                const rows = await connection.query(consulta, parametro.cod);
                producto = new Producto(rows[0][0]);
            }   

            return {existe, producto}

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        } 
    }
    //#endregion

    //#region ACTUALIZAR PRECIOS
    async ActualizarPrecioPorcentaje(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " UPDATE productos " +
                             " SET " +
                             "     costo = ?, " +
                             "     precio = ?, " +
                             "     redondeo = ?, " +
                             "     porcentaje = ?, " +
                             "     tipoPrecio = '%' " +
                             " WHERE id = ?";

            const parametros = [data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.id];

            await connection.query(consulta, parametros);
            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ActualizarPrecioFijo(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            const consulta = " UPDATE productos " +
                             " SET " +
                             "     costo = ?, " +
                             "     precio = ?, " +
                             "     tipoPrecio = '$' " +
                             " WHERE id = ?";

            const parametros = [data.costo,
                                data.precio,
                                data.id];

            await connection.query(consulta, parametros);
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
        let orden:string = "";
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " AND (p.nombre LIKE '%"+ filtros.busqueda + "%' OR p.codigo LIKE '%" + filtros.busqueda + "%')";

        if (filtros.faltantes != null && filtros.faltantes == true)
            filtro += " AND p.cantidad <= p.faltante + 1";

        if (filtros.vencimientos != null && filtros.vencimientos == true)
            filtro += " AND p.vencimiento IS NOT NULL";

        // #endregion

        // #region ORDENAMIENTO
        if (filtros.orden != null && filtros.orden != ""){
            orden += " ORDER BY p."+ filtros.orden + " " + filtros.direccion;
        }else if(filtros.vencimientos != null && filtros.vencimientos == true){
            orden += " ORDER BY p.vencimiento ASC";
        } 
        else{
            orden += " ORDER BY p.id DESC";
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
                " SELECT p.* " +
                " FROM productos p " +
                " WHERE p.id <> 1 " +
                filtro +
                orden +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean, consultaExcel:boolean):Promise<any>{
    try {
        let consulta = " SELECT id FROM productos WHERE codigo = ? ";
        if(modificando) consulta += " AND id <> ? ";
        const parametros = [data.codigo.toUpperCase(), data.id];
        const rows = await connection.query(consulta,parametros);

        if(!consultaExcel){
            if(rows[0].length > 0) return true;
            return false;
        }else{ //Si es consulta desde importacion excel necesito el ID
            if(rows[0].length > 0) return rows[0][0].id;
            return 0;
        }
        
    } catch (error) {
        throw error; 
    }
}

export const ProductosRepo = new ProductosRepository();