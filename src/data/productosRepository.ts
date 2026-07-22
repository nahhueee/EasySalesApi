import moment from 'moment';
import db from '../db';
import { Producto } from '../models/Producto';
import { ProductoPrecio } from '../models/ProductoPrecio';
import { SesionServ } from '../services/sesionService';

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
                    let producto:Producto = this.CompletarObjeto(row);
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

    CompletarObjeto(row){
        let producto:Producto = new Producto({
            id: row['id'],
            codigo: row['codigo'],
            nombre: row['nombre'],
            cantidad: row['cantidad'],
            costo: row['costo'],
            precio: row['precio'],
            tipoPrecio: row['tipoPrecio'],
            sumarIva: row['sumarIva'],
            redondeo: row['redondeo'],
            porcentaje: row['porcentaje'],
            vencimiento: row['vencimiento'],
            faltante: row['faltante'],
            unidad: row['unidad'],
            imagen: row['imagen'],
            idCategoria: row['idCategoria'],
            soloPrecio: row['soloPrecio'],
        });

        // No forman parte del modelo Producto (son del JOIN a categorias, ver ObtenerQuery) —
        // se agregan sueltas para no ensuciar el constructor con campos que no le pertenecen.
        (producto as any).categoriaNombre = row['categoriaNombre'];
        (producto as any).categoriaColor = row['categoriaColor'];

        return producto;
    }

    //Busca los productos segun lo que digite el usuario
    //en la ventana de nueva venta
    //idLista opcional: si viene y no es la lista default, resuelve el precio contra
    //productos_precios con fallback automatico a productos.precio (Minorista) si el
    //producto no tiene fila en esa lista. Sin idLista (o flag listasPrecios off), el
    //comportamiento es identico al de siempre: sin JOIN, lee productos.precio directo.
    async BuscarProductos(filtro:any){
        const connection = await db.getConnection();

        try {
            const idLista = filtro.idLista ? Number(filtro.idLista) : null;
            // Solo consultamos la lista default si realmente vino un idLista a resolver:
            // sin esto, cada búsqueda (autocomplete/scanner) pagaría un SELECT extra
            // aunque el flag listasPrecios esté off o no se haya mandado idLista.
            const usarLista = idLista != null && idLista !== await GetIdListaDefault(connection);

            const selectPrecio = usarLista ? 'COALESCE(pp.precio, p.precio)' : 'p.precio';
            const join = usarLista ? ' LEFT JOIN productos_precios pp ON pp.idProducto = p.id AND pp.idLista = ? ' : '';

            let consulta = `SELECT p.id, p.codigo, p.nombre, p.costo, ${selectPrecio} AS precio, p.unidad, p.imagen
                             FROM productos p ${join}
                             WHERE p.id <> 1 AND p.soloPrecio = 0 `;
            const params:any[] = usarLista ? [idLista] : [];

            if (filtro.metodo == 'codigo'){
                consulta += ' AND p.codigo = ? ';
                params.push(filtro.valor);
            }

            if (filtro.metodo == 'nombre'){
                consulta += ' AND LOWER(p.nombre) LIKE ? ';
                params.push('%' + filtro.valor + '%');
            }

            consulta += ' ORDER BY p.nombre ASC';
            const [rows] = await connection.query(consulta, params);

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
                        imagen: row['imagen'],
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

    //Recalculo batch de precios para renglones ya cargados en una venta (new-venta), al cambiar
    //cliente o lista manualmente. Devuelve, por cada id, el precio resuelto para esa lista y si
    //se uso fallback a Minorista (no hay fila en productos_precios para ese producto+lista).
    //No confundir con ObtenerProductosIds: ese es de uso general (bulk en main-productos) y no
    //conoce listas de precio, mezclarlo hubiese acoplado dos features sin relacion.
    async ResolverPreciosLista(ids:number[], idLista:number){
        const connection = await db.getConnection();

        try {
            if (!ids || ids.length === 0) return [];

            const idListaDefault = await GetIdListaDefault(connection);

            if (idLista === idListaDefault) {
                const [rows] = await connection.query(
                    'SELECT id, precio, false AS fallback FROM productos WHERE id IN (?)', [ids]
                );
                return rows;
            }

            const [rows] = await connection.query(
                `SELECT p.id, COALESCE(pp.precio, p.precio) AS precio, (pp.id IS NULL) AS fallback
                 FROM productos p
                 LEFT JOIN productos_precios pp ON pp.idProducto = p.id AND pp.idLista = ?
                 WHERE p.id IN (?)`,
                [idLista, ids]
            );
            return rows;

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }

    async ObtenerProductosIds(ids:number[]){
        const connection = await db.getConnection();

        try {
            const [rows] = await connection.query('SELECT * FROM productos WHERE id IN(?)', [ids]);

            const productos:Producto[] = [];

            if (Array.isArray(rows)) {
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    let producto:Producto = this.CompletarObjeto(row);
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

    // Devuelve el historial de precios de un producto (append-only, más reciente primero)
    async ObtenerHistorial(idProducto: number, idLista?: number): Promise<any[]> {
        const connection = await db.getConnection();

        try {
            let consulta = `
                SELECT pph.id, pph.idProducto, pph.idLista, lp.nombre AS nombreLista,
                       pph.tipoPrecio, pph.porcentaje, pph.costo, pph.sumarIva,
                       pph.precio, pph.redondeo, pph.fecha, pph.idUsuario, pph.origen
                FROM producto_precio_historial pph
                INNER JOIN listas_precio lp ON lp.id = pph.idLista
                WHERE pph.idProducto = ?
            `;
            const params: any[] = [idProducto];

            if (idLista) {
                consulta += ' AND pph.idLista = ?';
                params.push(idLista);
            }

            consulta += ' ORDER BY pph.fecha DESC LIMIT 200';

            const [rows] = await connection.query(consulta, params);
            return Array.isArray(rows) ? rows as any[] : [];

        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Devuelve el último código personalizado usado (excluye barcodes: numérico puro de 8+ dígitos
    // y excluye los códigos 0-9 reservados para solo-precio).
    // Útil como hint en el formulario de alta para que el usuario sepa en qué secuencia está.
    async ObtenerUltimoCodigo(): Promise<string | null> {
        const connection = await db.getConnection();
        try {
            const [rows] = await connection.query(`
                SELECT codigo FROM productos
                WHERE id <> 1
                  AND soloPrecio = 0
                  AND NOT (codigo REGEXP '^[0-9]{8,}$')
                  AND NOT (codigo REGEXP '^[0-9]$')
                ORDER BY id DESC
                LIMIT 1
            `);
            if (Array.isArray(rows) && rows.length > 0) {
                return (rows[0] as any).codigo ?? null;
            }
            return null;
        } catch (error: any) {
            throw error;
        } finally {
            connection.release();
        }
    }

    // Devuelve todas las filas de productos_precios para un producto, incluyendo datos de la lista
    async ObtenerPrecios(idProducto: number): Promise<ProductoPrecio[]> {
        const connection = await db.getConnection();

        try {
            const consulta = `
                SELECT pp.id, pp.idProducto, pp.idLista, lp.nombre AS nombreLista, lp.esDefault,
                       pp.tipoPrecio, pp.costo, pp.precio, pp.porcentaje, pp.redondeo, pp.sumarIva
                FROM productos_precios pp
                INNER JOIN listas_precio lp ON lp.id = pp.idLista AND lp.activa = 1
                WHERE pp.idProducto = ?
                ORDER BY lp.esDefault DESC, lp.id ASC
            `;

            const [rows] = await connection.query(consulta, [idProducto]);
            const precios: ProductoPrecio[] = [];

            if (Array.isArray(rows)) {
                for (const row of rows) {
                    precios.push(new ProductoPrecio(row));
                }
            }

            return precios;

        } catch (error: any) {
            throw error;
        } finally {
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

            // Determinamos los campos de precio base para el espejo en productos
            // Si vienen precios[], usamos los de la lista default; si no, usamos los campos top-level
            const precioBase = ResolverPrecioBase(data);

            const consulta = `INSERT INTO productos(codigo,nombre,cantidad,tipoPrecio,sumarIva,costo,precio,redondeo,porcentaje,faltante,vencimiento,unidad,imagen,soloPrecio,idCategoria)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                precioBase.tipoPrecio,
                                precioBase.sumarIva ? 1 : 0,
                                precioBase.costo,
                                precioBase.precio,
                                precioBase.redondeo,
                                precioBase.porcentaje,
                                data.faltante,
                                data.vencimiento ? moment(data.vencimiento).format('YYYY-MM-DD'): null,
                                data.unidad,
                                data.imagen,
                                data.soloPrecio ? 1 : 0,
                                data.idCategoria || 0];

            const [result]: any = await connection.query(consulta, parametros);
            const idProducto = result.insertId;

            // Upsert en productos_precios
            await UpsertPreciosProducto(connection, idProducto, data);

            // Historial de precios (append-only, captura server-side)
            const preciosHistorial = data.precios && data.precios.length > 0
                ? data.precios
                : [{ idLista: await GetIdListaDefault(connection), tipoPrecio: data.tipoPrecio ?? '$', costo: data.costo ?? 0, precio: data.precio ?? 0, porcentaje: data.porcentaje ?? null, redondeo: data.redondeo ?? 0, sumarIva: data.sumarIva ?? false }];
            await InsertarHistorialPrecios(connection, idProducto, preciosHistorial, Number(data.idUsuario) || 0, 'ALTA');

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Agregar Producto: " + data.codigo.toUpperCase());

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

            // Determinamos los campos de precio base para el espejo en productos
            const precioBase = ResolverPrecioBase(data);

            const consulta = `UPDATE productos SET
                                codigo = ?,
                                nombre = ?,
                                cantidad = ?,
                                tipoPrecio = ?,
                                sumarIva = ?,
                                costo = ?,
                                precio = ?,
                                redondeo = ?,
                                porcentaje = ?,
                                faltante = ?,
                                vencimiento = ?,
                                unidad = ?,
                                imagen = ?,
                                soloPrecio = ?,
                                idCategoria = ?
                                WHERE id = ?`;

            const parametros = [data.codigo.toUpperCase(),
                                data.nombre.toUpperCase(),
                                data.cantidad,
                                precioBase.tipoPrecio,
                                precioBase.sumarIva ? 1 : 0,
                                precioBase.costo,
                                precioBase.precio,
                                precioBase.redondeo,
                                precioBase.porcentaje,
                                data.faltante,
                                data.vencimiento ? moment(data.vencimiento).format('YYYY-MM-DD'): null,
                                data.unidad,
                                data.imagen,
                                data.soloPrecio ? 1 : 0,
                                data.idCategoria || 0,
                                data.id];

            await connection.query(consulta, parametros);

            // Upsert en productos_precios (si vienen precios[])
            if (data.precios && Array.isArray(data.precios) && data.precios.length > 0) {
                // Leer ANTES del upsert — después la BD ya tiene los valores nuevos y la comparación da vacío
                const preciosCambiados = await FiltrarPreciosCambiados(connection, data.id, data.precios);
                await UpsertPreciosProducto(connection, data.id, data);
                if (preciosCambiados.length > 0) {
                    await InsertarHistorialPrecios(connection, data.id, preciosCambiados, Number(data.idUsuario) || 0, 'EDICION');
                }
            }

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Modificar Producto: " + data.codigo.toUpperCase());

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
            // Eliminar precios asociados primero (FK)
            await connection.query("DELETE FROM productos_precios WHERE idProducto = ?", [id]);
            await connection.query("DELETE FROM productos WHERE id = ?", [id]);

            //Registramos el Movimiento
            await SesionServ.RegistrarMovimiento("Eliminar Producto nro " + id);

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

    //Relacionar un producto a una categoría con un solo click desde el modal de categorías —
    //update puntual, no pasa por Modificar() para no tener que mandar precios/costo/etc.
    async AsignarCategoria(data:any): Promise<string>{
        const connection = await db.getConnection();

        try {
            const consulta = `UPDATE productos SET
                              idCategoria = ?
                              WHERE id = ?`;

            const parametros = [data.idCategoria || 0, data.idProducto];

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
            const idLista = data.idLista ?? await GetIdListaDefault(connection);

            // Upsert en productos_precios
            await UpsertUnPrecio(connection, {
                idProducto: data.id,
                idLista,
                tipoPrecio: '%',
                costo:      data.costo,
                precio:     data.precio,
                redondeo:   data.redondeo,
                porcentaje: data.porcentaje,
                sumarIva:   data.sumarIva,
            });

            // Espejo a productos si es la lista default
            const esDefault = await EsListaDefault(connection, idLista);
            if (esDefault) {
                await connection.query(
                    `UPDATE productos SET costo=?, precio=?, redondeo=?, porcentaje=?, tipoPrecio='%', sumarIva=? WHERE id=?`,
                    [data.costo, data.precio, data.redondeo, data.porcentaje, data.sumarIva ? 1 : 0, data.id]
                );
            }

            // Historial de precios (append-only, captura server-side)
            await InsertarHistorialPrecios(connection, data.id, [{
                idLista,
                tipoPrecio: '%',
                costo:      data.costo      ?? 0,
                precio:     data.precio     ?? 0,
                porcentaje: data.porcentaje ?? null,
                redondeo:   data.redondeo   ?? 0,
                sumarIva:   data.sumarIva   ?? false,
            }], Number(data.idUsuario) || 0, 'CAMBIO_MASIVO');

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
            const idLista = data.idLista ?? await GetIdListaDefault(connection);

            // Upsert en productos_precios
            await UpsertUnPrecio(connection, {
                idProducto: data.id,
                idLista,
                tipoPrecio: '$',
                costo:      data.costo,
                precio:     data.precio,
                redondeo:   0,
                porcentaje: null,
                sumarIva:   data.sumarIva,
            });

            // Espejo a productos si es la lista default
            const esDefault = await EsListaDefault(connection, idLista);
            if (esDefault) {
                await connection.query(
                    `UPDATE productos SET costo=?, precio=?, tipoPrecio='$', sumarIva=? WHERE id=?`,
                    [data.costo, data.precio, data.sumarIva ? 1 : 0, data.id]
                );
            }

            // Historial de precios (append-only, captura server-side)
            await InsertarHistorialPrecios(connection, data.id, [{
                idLista,
                tipoPrecio: '$',
                costo:      data.costo    ?? 0,
                precio:     data.precio   ?? 0,
                porcentaje: null,
                redondeo:   0,
                sumarIva:   data.sumarIva ?? false,
            }], Number(data.idUsuario) || 0, 'CAMBIO_MASIVO');

            return "OK";

        } catch (error:any) {
            throw error;
        } finally{
            connection.release();
        }
    }
    //#endregion
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers privados
// ─────────────────────────────────────────────────────────────────────────────

// Obtiene el idLista default desde la DB
async function GetIdListaDefault(connection): Promise<number> {
    const [rows] = await connection.query(
        'SELECT id FROM listas_precio WHERE esDefault = 1 LIMIT 1'
    );
    if (Array.isArray(rows) && rows.length > 0) return (rows[0] as any).id;
    throw new Error('No se encontró la lista de precios por defecto.');
}

// Verifica si una lista es la default
async function EsListaDefault(connection, idLista: number): Promise<boolean> {
    const [rows] = await connection.query(
        'SELECT esDefault FROM listas_precio WHERE id = ?', [idLista]
    );
    if (Array.isArray(rows) && rows.length > 0) return !!(rows[0] as any).esDefault;
    return false;
}

// Upsert de un único precio en productos_precios
async function UpsertUnPrecio(connection, p: {
    idProducto: number; idLista: number; tipoPrecio: string;
    costo: number; precio: number; redondeo: number;
    porcentaje: number | null; sumarIva: boolean;
}): Promise<void> {
    await connection.query(`
        INSERT INTO productos_precios (idProducto, idLista, tipoPrecio, costo, precio, redondeo, porcentaje, sumarIva)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            tipoPrecio = VALUES(tipoPrecio),
            costo      = VALUES(costo),
            precio     = VALUES(precio),
            redondeo   = VALUES(redondeo),
            porcentaje = VALUES(porcentaje),
            sumarIva   = VALUES(sumarIva)
    `, [
        p.idProducto, p.idLista, p.tipoPrecio,
        p.costo, p.precio, p.redondeo,
        p.porcentaje ?? null,
        p.sumarIva ? 1 : 0,
    ]);
}

// Upsert masivo: procesa data.precios[] o fallback a campos top-level con lista default
async function UpsertPreciosProducto(connection, idProducto: number, data: any): Promise<void> {
    if (data.precios && Array.isArray(data.precios) && data.precios.length > 0) {
        // Nuevo flujo multi-precio: el front envía cada lista explícitamente
        for (const p of data.precios) {
            await UpsertUnPrecio(connection, {
                idProducto,
                idLista:    p.idLista,
                tipoPrecio: p.tipoPrecio ?? '$',
                costo:      p.costo      ?? 0,
                precio:     p.precio     ?? 0,
                redondeo:   p.redondeo   ?? 0,
                porcentaje: p.porcentaje ?? null,
                sumarIva:   p.sumarIva   ?? false,
            });
        }
    } else {
        // Fallback (importación Excel o front viejo): usar campos top-level → lista default
        const idLista = await GetIdListaDefault(connection);
        await UpsertUnPrecio(connection, {
            idProducto,
            idLista,
            tipoPrecio: data.tipoPrecio ?? '$',
            costo:      data.costo      ?? 0,
            precio:     data.precio     ?? 0,
            redondeo:   data.redondeo   ?? 0,
            porcentaje: data.porcentaje ?? null,
            sumarIva:   data.sumarIva   ?? false,
        });
    }
}

// Resuelve los campos de precio que van al espejo en productos
// Si vienen precios[], toma el de la lista default; si no, usa campos top-level
function ResolverPrecioBase(data: any): any {
    if (data.precios && Array.isArray(data.precios) && data.precios.length > 0) {
        // Busca la lista marcada como esDefault o toma la primera
        const def = data.precios.find((p: any) => p.esDefault) ?? data.precios[0];
        return {
            tipoPrecio: def.tipoPrecio ?? '$',
            costo:      def.costo      ?? 0,
            precio:     def.precio     ?? 0,
            redondeo:   def.redondeo   ?? 0,
            porcentaje: def.porcentaje ?? null,
            sumarIva:   def.sumarIva   ?? false,
        };
    }
    // Fallback: campos top-level (comportamiento original)
    return {
        tipoPrecio: data.tipoPrecio,
        costo:      data.costo,
        precio:     data.precio,
        redondeo:   data.redondeo,
        porcentaje: data.porcentaje,
        sumarIva:   data.sumarIva,
    };
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
        if (filtros.busqueda != null && filtros.busqueda != "") {
            switch (filtros.tipoBusqueda) {
                case 'ambos':
                    filtro += " AND (p.nombre LIKE '%"+ filtros.busqueda + "%' OR p.codigo LIKE '%" + filtros.busqueda + "%')";
                    break;
                case 'codigo':
                    filtro += " AND p.codigo = " + filtros.busqueda + "";
                    break;
                case 'descripcion':
                    filtro += " AND LOWER(p.nombre) LIKE '%" + filtros.busqueda + "%'";
                    break;
            }
        }

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
                " SELECT p.*, c.nombre AS categoriaNombre, c.color AS categoriaColor " +
                " FROM productos p " +
                " LEFT JOIN categorias c ON c.id = p.idCategoria AND c.id <> 1 " +
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

// Compara los precios entrantes contra los actuales en BD.
// Devuelve solo los que cambiaron (o son nuevos — lista que antes no existía).
// Evita ruido en el historial cuando se guarda el producto sin tocar precios.
async function FiltrarPreciosCambiados(
    connection: any,
    idProducto: number,
    precios: any[]
): Promise<any[]> {
    const [rows] = await connection.query(
        'SELECT idLista, tipoPrecio, costo, precio, porcentaje, redondeo, sumarIva FROM productos_precios WHERE idProducto = ?',
        [idProducto]
    );

    const actuales = new Map<number, any>();
    if (Array.isArray(rows)) {
        for (const row of rows) actuales.set(row.idLista, row);
    }

    const eps = 0.001; // tolerancia para comparación de decimales

    return precios.filter(p => {
        const actual = actuales.get(p.idLista);
        if (!actual) return true; // lista nueva → siempre registrar

        const cambioCosto     = Math.abs((p.costo      ?? 0) - (actual.costo      ?? 0)) > eps;
        const cambioPrecio    = Math.abs((p.precio     ?? 0) - (actual.precio     ?? 0)) > eps;
        const cambioPorcentaje= Math.abs((p.porcentaje ?? 0) - (actual.porcentaje ?? 0)) > eps;
        const cambioTipo      = (p.tipoPrecio ?? '$') !== actual.tipoPrecio;
        const cambioRedondeo  = (p.redondeo   ?? 0)   !== (actual.redondeo ?? 0);
        const cambioIva       = Boolean(p.sumarIva)    !== Boolean(actual.sumarIva);

        return cambioCosto || cambioPrecio || cambioPorcentaje || cambioTipo || cambioRedondeo || cambioIva;
    });
}

// Inserta filas de historial de precios (append-only — nunca actualiza).
// Se llama server-side, dentro del mismo flujo de persistencia, para garantizar trazabilidad.
async function InsertarHistorialPrecios(
    connection: any,
    idProducto: number,
    precios: Array<{
        idLista: number;
        tipoPrecio: string;
        costo: number;
        precio: number;
        porcentaje: number | null;
        redondeo: number;
        sumarIva: boolean;
    }>,
    idUsuario: number,
    origen: 'ALTA' | 'EDICION' | 'CAMBIO_MASIVO'
): Promise<void> {
    if (!precios || precios.length === 0) return;

    for (const p of precios) {
        await connection.query(`
            INSERT INTO producto_precio_historial
                (idProducto, idLista, tipoPrecio, porcentaje, costo, sumarIva, precio, redondeo, fecha, idUsuario, origen)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
        `, [
            idProducto,
            p.idLista,
            p.tipoPrecio  ?? '$',
            p.porcentaje  ?? null,
            p.costo       ?? 0,
            p.sumarIva    ? 1 : 0,
            p.precio      ?? 0,
            p.redondeo    ?? 0,
            idUsuario     || 0,
            origen,
        ]);
    }
}

export const ProductosRepo = new ProductosRepository();
