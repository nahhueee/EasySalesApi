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
                        categoria: row['categoria'],
                        activo: row['activo'],
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

    async ProductosSelector(){
        const connection = await db.getConnection();
        
        try {
            const [rows] = await connection.query('SELECT id, codigo, nombre, costo, precio, unidad FROM productos WHERE id <> 1');
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
    //#endregion

    //#region ABM
    async Agregar(data:any): Promise<string>{
        const connection = await db.getConnection();
        
        try {
            let existe = await ValidarExistencia(connection, data, false);
            if(existe)//Verificamos si ya existe un producto con el mismo nombre o codigo
                return "Ya existe un producto con el mismo nombre o código.";
            
            const consulta = `INSERT INTO productos(codigo,nombre,cantidad,tipoPrecio,costo,precio,redondeo,porcentaje,vencimiento,faltante,unidad,imagen,idCategoria)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                data.tipoPrecio,
                                data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.vencimiento,
                                data.faltante,
                                data.unidad,
                                data.imagen,
                                data.categoria.id];
            
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
            if(existe)//Verificamos si ya existe un producto con el mismo nombre o codigo
                return "Ya existe un producto con el mismo nombre o código.";
            
            const consulta = `UPDATE productos SET
                                codigo = ?,
                                nombre = ?,
                                cantidad = ?,
                                tipoPrecio = ?,
                                costo = ?,
                                precio = ?,
                                redondeo = ?,
                                porcentaje = ?,
                                vencimiento = ?,
                                faltante = ?,
                                unidad = ?,
                                imagen = ?,
                                idCategoria = ?
                                WHERE id = ?`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                data.tipoPrecio,
                                data.costo,
                                data.precio,
                                data.redondeo,
                                data.porcentaje,
                                data.vencimiento,
                                data.faltante,
                                data.unidad,
                                data.imagen,
                                data.categoria.id,
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
                             "     porcentaje = ? " +
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
                             "     precio = ? " +
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
        let paginado:string = "";
    
        let count:string = "";
        let endCount:string = "";
        //#endregion

        // #region FILTROS
        if (filtros.busqueda != null && filtros.busqueda != "") 
            filtro += " AND (p.nombre LIKE '%"+ filtros.busqueda + "%' OR p.codigo LIKE '%" + filtros.busqueda + "%')";

        if(filtros.categoria != 0)
            filtro += " AND p.idCategoria = " + filtros.categoria;
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
                " SELECT p.*, COALESCE(c.nombre, 'ELIMINADO') categoria " +
                " FROM productos p " +
                " LEFT JOIN categorias c ON c.id = p.idCategoria " +
                " WHERE p.id <> 1 " +
                filtro +
                " ORDER BY p.id DESC" +
                paginado +
                endCount;

        return query;
            
    } catch (error) {
        throw error; 
    }
}

async function ValidarExistencia(connection, data:any, modificando:boolean):Promise<boolean>{
    try {
        let consulta = " SELECT id FROM productos WHERE nombre = ? OR codigo = ? ";
        if(modificando) consulta += " AND id <> ? ";

        const parametros = [data.nombre.toUpperCase(),data.codigo.toUpperCase(), data.id];

        const rows = await connection.query(consulta,parametros);
        if(rows[0].length > 0) return true;

        return false;
    } catch (error) {
        throw error; 
    }
}

export const ProductosRepo = new ProductosRepository();