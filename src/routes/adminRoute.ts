import {AdminServ} from '../services/adminService';
import {Router, Request, Response} from 'express';
import { TerminalServ } from '../services/terminalService';
const router : Router  = Router();

//Obtiene la version en linea del sistema 
router.get('/obtener-version', async (req:Request, res:Response, next) => {
    try{ 
        const respuesta = await AdminServ.ObtenerVersionWeb();
        return res.json(respuesta);

    } catch(error:any){
       next(error);
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