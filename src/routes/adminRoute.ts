import {AdminServ} from '../services/adminService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//Obtiene la version en linea del sistema 
router.get('/obtener-version/:dni', async (req:Request, res:Response) => {
    try{ 
        let habilitado = await AdminServ.ObtenerHabilitacion(req.params.dni); //Verificamos que el usuario pueda actualizar
        if(habilitado)
            res.json(await AdminServ.ObtenerVersionApp());
        else
            res.json(null);

    } catch(error:any){
        logger.error("Error al intentar obtener la versión de la aplicación. " + error);
        res.status(200).send(null);
    }
});

//Verifica la existencia del cliente mediante DNI
router.get('/verificar-existencia/:dni', async (req:Request, res:Response) => {
    try{ 
        res.json(await AdminServ.VerificarExistenciaCliente(req.params.dni));

    } catch(error:any){
        let msg = "Error al intentar verificar el cliente con el DNI " + req.params.dni + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//Obtiene la terminal asociada al DNI y mac del cliente para esta aplicacion
router.get('/obtener-app-cliente/:dni', async (req:Request, res:Response) => {
    try{ 
        res.json(await AdminServ.ObtenerAppCliente(req.params.dni));

    } catch(error:any){
        let msg = "Error al intentar obtener la terminal asociada al cliente " + req.params.dni + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//Verifica si el cliente esta habilitado para acceder a ciertas funciones
router.get('/obtener-habilitacion/:dni', async (req:Request, res:Response) => {
    try{ 
        res.json(await AdminServ.ObtenerHabilitacion(req.params.dni));

    } catch(error:any){
        let msg = "Error al intentar obtener la habilitacion de terminal asociada al cliente " + req.params.dni + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


// Export the router
export default router; 