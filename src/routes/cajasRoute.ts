import {CajasRepo} from '../data/cajasRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de cajas.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-caja/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.ObtenerCaja({idCaja: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener la caja nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.put('/finalizar', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.Finalizar(req.body));

    } catch(error:any){
        let msg = "Error al intentar actualizar el estado de la caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar una nueva caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar la caja nro " + req.body.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await CajasRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar la caja nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 