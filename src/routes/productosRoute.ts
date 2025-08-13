import { ProductosRepo } from '../data/productosRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
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

router.get('/productos-soloPrecio', async (req:Request, res:Response) => {
    try{ 
        res.json(await ProductosRepo.ObtenerProductosSoloPrecio());

    } catch(error:any){
        let msg = "Error al obtener el listado de productos tipo soloPrecio.";
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

// Export the router
export default router; 