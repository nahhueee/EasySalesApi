import {ClientesRepo} from '../data/clientesRepository';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de clientes.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-cliente/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.ObtenerCliente({idCliente: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener el cliente nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.ClientesSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de clientes.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await ClientesRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el cliente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 