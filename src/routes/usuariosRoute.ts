import {UsuariosRepo} from '../data/usuariosRepository';
import { SesionServ } from '../services/sesionService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de usuarios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-usuario/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.ObtenerUsuario({usuario: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener el usuario nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector-cargos', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.CargosSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de cargos.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.UsuariosSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de usuarios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/obtener-movimientos', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.ObtenerMovimientos(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de movimientos para el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

//#endregion

//#region ABM
router.put('/guardar-sesion', async (req:Request, res:Response) => {
    try{ 
        res.json(await SesionServ.GuardarSesion(req.body.id, req.body.nombre, req.body.cargo.nombre));

    } catch(error:any){
        let msg = "Error al intentar guardar la sesion.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});


router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await UsuariosRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el usuario.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 