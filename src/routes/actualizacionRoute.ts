import {ActualizacionServ} from '../services/actualizacionService';
import {Router, Request, Response} from 'express';
import logger from '../log/logger';
import config from '../conf/app.config';
const router : Router  = Router();


router.post('/actualizar/', async (req:Request, res:Response) => {
    try{ 
        if(req.body){
            await ActualizacionServ.Actualizar(req.body.url)
            res.json("OK");
        }else
            throw {message:"No se proporcionó data"};

    } catch(error:any){
        logger.error("Error al intentar actualizar. " + error);
        res.status(200).send(false);
    }
});


// Export the router
export default router; 