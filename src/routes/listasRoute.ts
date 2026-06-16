import { ListasRepo } from '../data/listasRepository';
import { Router, Request, Response } from 'express';
import logger from '../logger/loggerGeneral';

const router: Router = Router();

router.get('/obtener', async (req: Request, res: Response) => {
    try {
        res.json(await ListasRepo.Obtener());
    } catch (error: any) {
        const msg = "Error al obtener las listas de precios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/agregar', async (req: Request, res: Response) => {
    try {
        res.json(await ListasRepo.Agregar(req.body));
    } catch (error: any) {
        const msg = "Error al agregar la lista de precios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req: Request, res: Response) => {
    try {
        res.json(await ListasRepo.Modificar(req.body));
    } catch (error: any) {
        const msg = "Error al modificar la lista de precios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Baja lógica (no borra datos)
router.delete('/eliminar/:id', async (req: Request, res: Response) => {
    try {
        res.json(await ListasRepo.Eliminar(Number(req.params.id)));
    } catch (error: any) {
        const msg = "Error al dar de baja la lista de precios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/reactivar/:id', async (req: Request, res: Response) => {
    try {
        res.json(await ListasRepo.Reactivar(Number(req.params.id)));
    } catch (error: any) {
        const msg = "Error al reactivar la lista de precios.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

export default router;
