import {RegistrosRepo} from '../data/registrosRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await RegistrosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de registros.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-registro/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await RegistrosRepo.ObtenerRegistro({idRegistro: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener el registro nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await RegistrosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el registro.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await RegistrosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el registro.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await RegistrosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el registro.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 