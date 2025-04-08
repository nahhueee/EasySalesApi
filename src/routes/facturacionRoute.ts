import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import {FacturacionServ} from '../services/facturacionService';

const router : Router  = Router();


router.get('/server-status', async (req:Request, res:Response) => {
    try{ 
        res.json(await FacturacionServ.EstadoServidor());

    } catch(error:any){
        let msg = "Error al intentar consultar el estado del servidor ARCA.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/facturar', async (req:Request, res:Response) => {
    try{ 
        res.json(await FacturacionServ.Facturar());

    } catch(error:any){
        let msg = "Error al intentar facturar el comprobante.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Export the router
export default router; 