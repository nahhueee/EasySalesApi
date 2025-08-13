import {EtiquetasRepo} from '../data/etiquetasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.get('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Obtener(""));

    } catch(error:any){
        let msg = "Error al obtener el listado de etiquetas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.get('/obtener/:descripcion', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Obtener(req.params.descripcion));

    } catch(error:any){
        let msg = "Error al obtener el listado de etiquetas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-etiqueta/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.ObtenerEtiqueta(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener la etiqueta nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await EtiquetasRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar una etiqueta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 