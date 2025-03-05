import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { ParametrosRepo } from '../data/parametrosRepository';
const router : Router  = Router();


router.post('/ok', async (req:Request, res:Response) => {
    try{ 
        if(req.body){
            //Actualizamos el aviso de que se actualizo el sistema
            await ParametrosRepo.ActualizarParametro({clave:"actualizado", valor:"true"})
            //Actualizamos localmente la version
            res.json(await ParametrosRepo.ActualizarParametro(req.body));
        }else
            throw {message:"No se proporcionó data"};

    } catch(error:any){
        logger.error("Error al intentar informar la actualización. " + error);
        res.status(500).send(false);
    }
});

// Export the router
export default router; 