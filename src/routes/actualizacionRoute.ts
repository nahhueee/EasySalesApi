import {ActualizarServ} from '../services/actualizarService';
import {Router, Request, Response} from 'express';
import logger from '../log/logger';
import config from '../conf/app.config';
const router : Router  = Router();


router.post('/actualizar/', async (req:Request, res:Response) => {
    try{ 
        if(req.body){
            res.json(await ActualizarServ.Actualizar(req.body.url));
        }else
            throw {message:"No se proporcionó data"};

    } catch(error:any){
        logger.error("Error al intentar actualizar. " + error);
        res.status(500).send(false);
    }
});

// Export the router
export default router; 