import { ProductosRepo } from '../data/productosRepository';
import { RubrosRepo } from '../data/rubrosRepository';
import { ProveedoresRepo } from '../data/proveedoresRepository';
import { ProductosProveedoresRepo } from '../data/productosProveedoresRepository';
import { ImportacionCostosRepo } from '../data/importacionCostosRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import { ExportProductosServ, ExportLimiteExcedidoError } from '../services/exportProductosService';
import { datosAuditoria } from '../utils/auditoria';
import { SesionServ } from '../services/sesionService';
const router : Router  = Router();

//#region OBTENER
// Rubro repuestos (handoff_repuestos_fases1_2_3.md, Fase 2 PR 2.2) — alimenta el autocomplete
// de marca/vehiculo del modal. Whitelist acá (y de nuevo en el repo, por las dudas).
const CAMPOS_VALORES_DISTINTOS_PERMITIDOS = ['marca', 'vehiculo'];
router.get('/valores-distintos/:campo', async (req:Request, res:Response) => {
    try{
        const campo = req.params.campo;
        if (!CAMPOS_VALORES_DISTINTOS_PERMITIDOS.includes(campo)) {
            return res.status(400).send('Campo no permitido.');
        }
        res.json(await ProductosRepo.ObtenerValoresDistintos(campo));

    } catch(error:any){
        let msg = "Error al obtener los valores distintos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/precios/:idProducto', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosRepo.ObtenerPrecios(Number(req.params.idProducto)));

    } catch(error:any){
        let msg = "Error al obtener los precios del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/historial/:idProducto', async (req:Request, res:Response) => {
    try{
        const idProducto = Number(req.params.idProducto);
        const idLista    = req.query.idLista ? Number(req.query.idLista) : undefined;
        res.json(await ProductosRepo.ObtenerHistorial(idProducto, idLista));

    } catch(error:any){
        let msg = "Error al obtener el historial de precios del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/ultimo-codigo', async (req:Request, res:Response) => {
    try {
        res.json(await ProductosRepo.ObtenerUltimoCodigo());
    } catch(error:any){
        let msg = "Error al obtener el último código personalizado.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/verificar/:cod', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.VerificarYObtener(req.params));

    } catch(error:any){
        let msg = "Error intentando buscar productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/buscar-productos', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosRepo.BuscarProductos(req.body));

    } catch(error:any){
        let msg = "Error intentando buscar productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// PR C1 (handoff_faltantes_pedido_proveedor.md). Contrato genérico desde el día 1:
// {filtro, formato, plantilla} aunque hoy solo exista un valor válido de cada uno —
// ver PLANTILLAS_VALIDAS/FORMATOS_VALIDOS en ExportProductosService. El endpoint
// fuerza sinPaginacion server-side, no confía en pagina/tamanioPagina del front.
router.post('/exportar', async (req:Request, res:Response) => {
    try{
        const { filtro, formato, plantilla } = req.body;

        const resultado = await ExportProductosServ.exportar(plantilla, formato, filtro);

        const { usuarioId, puestoId } = datosAuditoria(req);
        await SesionServ.RegistrarMovimiento(
            `Exportó pedido a proveedor (${resultado.filas} productos, plantilla ${plantilla})`,
            usuarioId,
            puestoId
        );

        logger.info(`Export de productos: plantilla=${plantilla} formato=${formato} filas=${resultado.filas} duracionMs=${resultado.duracionMs}`);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="pedido_${new Date().toISOString().slice(0, 10)}.pdf"`);
        res.send(resultado.buffer);

    } catch(error:any){
        if (error instanceof ExportLimiteExcedidoError) {
            res.status(400).send(error.message);
            return;
        }
        if (typeof error?.message === 'string' && error.message.startsWith('Plantilla de exportación inválida')) {
            res.status(400).send(error.message);
            return;
        }
        if (typeof error?.message === 'string' && error.message.startsWith('Formato de exportación inválido')) {
            res.status(400).send(error.message);
            return;
        }

        let msg = "Error al exportar el listado de productos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/resolver-precios-lista', async (req:Request, res:Response) => {
    try{
        const { ids, idLista } = req.body;
        res.json(await ProductosRepo.ResolverPreciosLista(ids, idLista));

    } catch(error:any){
        let msg = "Error al resolver precios por lista.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/productos-soloPrecio', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ObtenerProductosSoloPrecio());

    } catch(error:any){
        let msg = "Error al obtener el listado de productos tipo soloPrecio.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/productos-ids', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ObtenerProductosIds(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de productos por ids.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/actualizar-varios', async (req:Request, res:Response) => {
    try{ 
        let errores:string[] = [];
        let insertados:number = 0;
        let actualizados:number = 0;

        const productos = req.body.productos;
        const accionActualizar = req.body.accion;
        if (!productos || !Array.isArray(productos)) {
            return res.status(400).json({ mensaje: "Formato inválido de productos." });
        }

        // PR 1.3 (handoff_repuestos_fases1_2_3.md) — categoria/proveedor vienen como texto desde
        // el Excel (columnas opcionales). Se resuelven a ids de una sola vez para todo el lote,
        // no una consulta por fila. Si un producto no trae la columna, sigue el comportamiento
        // de hoy (idCategoria = 0 / idProveedor = null vía "|| 0" / "|| null" en el repo).
        // categoriaExcel/proveedorExcel: nombre en texto tal como vino de la columna del Excel
        // (ver Producto.ts). No confundir con `categoria`/`categoriaNombre` del modelo, que son
        // el objeto/nombre de solo lectura que viene del JOIN al leer productos existentes.
        const nombresCategoria = productos.map((p: any) => p.categoriaExcel).filter((n: any) => n);
        const nombresProveedor = productos.map((p: any) => p.proveedorExcel).filter((n: any) => n);
        const mapaCategorias = nombresCategoria.length > 0
            ? await RubrosRepo.ResolverPorNombre(nombresCategoria)
            : new Map<string, number>();
        const mapaProveedores = nombresProveedor.length > 0
            ? await ProveedoresRepo.ResolverPorNombre(nombresProveedor)
            : new Map<string, number>();

        const normalizar = (n: string) => n.replace(/\s+/g, ' ').trim().toUpperCase();
        for (const prod of productos) {
            if (prod.categoriaExcel) prod.idCategoria = mapaCategorias.get(normalizar(prod.categoriaExcel));
            if (prod.proveedorExcel) prod.idProveedor = mapaProveedores.get(normalizar(prod.proveedorExcel));
        }

        for (const [i, prod] of productos.entries()) {
            try {
            const existente = await ProductosRepo.ValidarCodigo(prod);
            if (existente==0) {
                await ProductosRepo.Agregar(prod);
                insertados++;
            } else {
                prod.id = existente;

                if(accionActualizar == "ACTUALIZAR"){
                    await ProductosRepo.Modificar(prod);
                    actualizados++;
                }else if(accionActualizar == "SUMARSTOCK"){
                    const producto = await ProductosRepo.ObtenerUno(prod.id)
                    let nvaCantidad = prod.cantidad + producto.cantidad;
                    
                    if(producto.id!=0){
                        await ProductosRepo.AniadirCantidad({cant:nvaCantidad, idProducto:producto.id});
                        actualizados++;
                    }else{
                        errores.push(`No se pudo actualizar el producto con código ${prod.codigo}.`);
                    }
                }
                else{
                    errores.push(`Ya existe un producto con el código ${prod.codigo}.`);
                }
            }
            } catch (err) { //Si se encuentran errores grabamos
                errores.push(`Error en fila ${i + 1}: ${err}`);
            }
        }

        return res.json({
            insertados,
            actualizados,
            errores,
        });

    } catch(error:any){
        let msg = "Error al intentar actualizar productos desde Excel.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.put('/aniadir', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.AniadirCantidad(req.body));

    } catch(error:any){
        let msg = "Error al intentar añadir cantidad al producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-faltante', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ActualizarFaltante(req.body));

    } catch(error:any){
        let msg = "Error al intentar actualizar el nro aviso faltante.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/asignar-categoria', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosRepo.AsignarCategoria(req.body));

    } catch(error:any){
        let msg = "Error al intentar asignar la categoría del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Fase 4, PR 8 — reposición por proveedor. Espejo de /asignar-categoria.
router.put('/asignar-proveedor', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosRepo.AsignarProveedor(req.body));

    } catch(error:any){
        let msg = "Error al intentar asignar el proveedor del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Fase 3, PR 3.2 (handoff_repuestos_fases1_2_3.md) -- multi-proveedor por producto. Distinto
// de /asignar-proveedor de arriba (que sigue existiendo, sin tocar: escribe directo el
// espejo productos.idProveedor para quien todavia no usa la tabla nueva). Estos cuatro
// endpoints son el ABM de productos_proveedores.
router.get('/proveedores/:idProducto', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosProveedoresRepo.Obtener(Number(req.params.idProducto)));

    } catch(error:any){
        let msg = "Error al obtener los proveedores del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/proveedores/guardar', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosProveedoresRepo.Guardar(req.body));

    } catch(error:any){
        let msg = "Error al guardar el proveedor del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/proveedores/marcar-principal', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosProveedoresRepo.MarcarPrincipal(req.body));

    } catch(error:any){
        let msg = "Error al marcar el proveedor principal del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/proveedores/eliminar/:id', async (req:Request, res:Response) => {
    try{
        res.json(await ProductosProveedoresRepo.Eliminar(Number(req.params.id)));

    } catch(error:any){
        let msg = "Error al quitar el proveedor del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-vencimiento', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ActualizarVencimiento(req.body));

    } catch(error:any){
        let msg = "Error al intentar actualizar la fecha de vencimiento.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-imagen', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ActualizarImagen(req.body));

    } catch(error:any){
        let msg = "Error al intentar actualizar la imagen del producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el producto.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ACTUALIZAR PRECIOS
router.put('/actualizar-precio', async (req:Request, res:Response) => {
    try{ 
        if(req.body.tipoPrecio == "%")
            res.json(await ProductosRepo.ActualizarPrecioPorcentaje(req.body));

        if(req.body.tipoPrecio == "$")
            res.json(await ProductosRepo.ActualizarPrecioFijo(req.body));

    } catch(error:any){
        let msg = "No se pudo actualizar el precio de un producto. nro " + req.body.id;
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region IMPORTACION DE PRECIOS DE PROVEEDOR (MVP)
// documentos/handoff_importacion_precios_proveedor.md. El matching y el parseo del archivo
// pasan por files/procesar-lista-precios (ver filesRoute.ts) -- acá sólo se aplica el lote ya
// confirmado por el usuario en el paso 3, y se lo puede deshacer.
router.post('/aplicar-costos-lote', async (req:Request, res:Response) => {
    try{
        const { idProveedor, nombreArchivo, idUsuario, filas } = req.body;
        if (!idProveedor || !Array.isArray(filas) || filas.length === 0) {
            return res.status(400).json({ mensaje: "Formato inválido: falta idProveedor o filas." });
        }

        const resultado = await ImportacionCostosRepo.AplicarLote({
            idProveedor: Number(idProveedor),
            nombreArchivo: nombreArchivo ?? null,
            idUsuario: Number(idUsuario) || 0,
            filas,
        });
        res.json(resultado);

    } catch(error:any){
        let msg = "Error al aplicar el lote de costos importado.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/deshacer-importacion-costos', async (req:Request, res:Response) => {
    try{
        const idImportacion = Number(req.body.idImportacion);
        const idUsuario = Number(req.body.idUsuario) || 0;
        if (!idImportacion) {
            return res.status(400).json({ mensaje: "Falta idImportacion." });
        }

        const resultado = await ImportacionCostosRepo.DeshacerImportacion(idImportacion, idUsuario);
        if (typeof resultado === 'string') {
            return res.status(400).json({ mensaje: resultado });
        }
        res.json(resultado);

    } catch(error:any){
        let msg = "Error al deshacer la importación de costos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/ultima-importacion-costos/:idProveedor', async (req:Request, res:Response) => {
    try{
        const idProveedor = Number(req.params.idProveedor);
        res.json(await ImportacionCostosRepo.ObtenerUltimaImportacion(idProveedor));

    } catch(error:any){
        let msg = "Error al obtener la última importación de costos del proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 