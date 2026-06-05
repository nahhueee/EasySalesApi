import { PresupuestosRepo } from '../data/presupuestosRepository';
import { Router, Request, Response } from 'express';
import { logger } from '../logger/logger';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

const router: Router = Router();

//#region OBTENER
router.post('/obtener', async (req: Request, res: Response, next) => {
    try {
        res.json(await PresupuestosRepo.Obtener(req.body));
    } catch (error: any) {
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener los presupuestos.', 500, { modulo: 'presupuestosRoute.obtener' }, error));
    }
});

router.get('/detalle/:id', async (req: Request, res: Response, next) => {
    try {
        res.json(await PresupuestosRepo.ObtenerDetalle(parseInt(req.params.id)));
    } catch (error: any) {
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener el detalle del presupuesto.', 500, { modulo: 'presupuestosRoute.detalle' }, error));
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req: Request, res: Response, next) => {
    try {
        const id = await PresupuestosRepo.Agregar(req.body);
        res.json({ id });
    } catch (error: any) {
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al guardar el presupuesto.', 500, { modulo: 'presupuestosRoute.agregar' }, error));
    }
});

router.put('/anular/:id', async (req: Request, res: Response, next) => {
    try {
        await PresupuestosRepo.Anular(parseInt(req.params.id));
        res.json('OK');
    } catch (error: any) {
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al anular el presupuesto.', 500, { modulo: 'presupuestosRoute.anular' }, error));
    }
});
//#endregion

export default router;
