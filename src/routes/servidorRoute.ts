import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import {ServidorServ} from '../services/servidorService';
import config from '../conf/app.config';


const router : Router  = Router();
router.get('/forzar', async (req:Request, res:Response) => {
    try{ 
        ServidorServ.IniciarModoServidor();
        res.json("OK");

    } catch(error:any){
        let msg = "Error al intentar forzar el inicio del modo servidor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/estado', async (req:Request, res:Response) => {
    try{
        res.json(config.esServer);

    } catch(error:any){
        let msg = "Error al intentar obtener el modo de trabajo del servidor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Activa/desactiva el modo servidor: persiste config.pc.json y reinicia PM2.
// Reemplaza al comando Tauri change_config_reset (ver servidorService.CambiarModoServidor).
router.post('/modo', async (req:Request, res:Response) => {
    try{
        const { esServer } = req.body;

        if (typeof esServer !== 'boolean') {
            res.status(400).send("El campo 'esServer' es requerido y debe ser booleano.");
            return;
        }

        await ServidorServ.CambiarModoServidor(esServer);
        res.json("OK");

    } catch(error:any){
        let msg = "Error al intentar configurar el modo servidor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router;