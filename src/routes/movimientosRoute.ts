import {MovimientosRepo} from '../data/movimientosRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await MovimientosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de movimientos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await MovimientosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el movimiento.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/eliminar', async (req:Request, res:Response) => {
    try{ 
        res.json(await MovimientosRepo.Eliminar(req.body));

    } catch(error:any){
        let msg = "Error al intentar eliminar el movimiento.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 