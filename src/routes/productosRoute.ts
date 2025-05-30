import {ProductosRepo} from '../data/productosRepository';
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
        const actualizarExistentes = req.body.actualizarExistentes;
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
                if(actualizarExistentes){
                    prod.id = existente;
                    await ProductosRepo.Modificar(prod);
                    actualizados++;
                }else{
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