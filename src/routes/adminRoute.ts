import {AdminServ} from '../services/adminService';
import {ParametrosRepo} from '../data/parametrosRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import config from '../conf/app.config';
import { TerminalServ } from '../services/terminalService';
const router : Router  = Router();

//Obtiene la version en linea del sistema 
router.get('/obtener-version', async (req:Request, res:Response) => {
    try{ 
        const respuesta = await AdminServ.ObtenerVersionApp();

        //Obtenemos del config el estado del servidor
        if(config.produccion)
            respuesta.serverStatus = 'production';
        else
            respuesta.serverStatus = 'test';

        return res.json(respuesta);

    } catch(error:any){
        logger.error("Error al intentar obtener la versión de la aplicación. " + error);
        res.status(200).send(null);
    }
});

//Valida la identidad del cliente
router.get('/validar/:dni', async (req:Request, res:Response, next) => {
    try{ 
        res.json(await AdminServ.ValidarIdentidad(req.params.dni));

    } catch(error:any){
       next(error);
    }
});

//Verifica si el cliente esta habilitado para acceder a ciertas funciones
router.get('/obtener-habilitacion', async (req:Request, res:Response, next) => {
    try{ 
        await TerminalServ.VerificarTerminalHabilitada();
        return res.json({habilitado: true});
    } catch(error:any){
       next(error);
    }
});


// Export the router
export default router; 