import {Router, Request, Response} from 'express';
import {BackupsServ} from '../services/backupService';
import logger from '../log/loggerGeneral';
const router : Router  = Router();


router.get('/forzar', async (req:Request, res:Response) => {
    try{ 
        BackupsServ.IniciarCron();
        res.json();

    } catch(error:any){
        let msg = "Error al intentar evaluar el inicio de cron.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 