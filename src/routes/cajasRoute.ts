import {CajasRepo} from '../data/cajasRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { datosAuditoria } from '../utils/auditoria';
import { ResumenCajaServ } from '../services/resumenCajaService';
import { CierreCajaServ } from '../services/cierreCajaService';
import { EsArqueoCiego } from '../utils/permisos';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response, next) => {
    try{
        res.json(await CajasRepo.Obtener(req.body));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener el listado de cajas.', 500, { modulo: 'cajasRoute.obtener' }, error));
    }
});

router.get('/activas', async (req:Request, res:Response, next) => {
    try{
        res.json(await CajasRepo.ObtenerActivas());

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener el listado de cajas activas.', 500, { modulo: 'cajasRoute.activas' }, error));
    }
});

router.get('/obtener-caja/:id', async (req:Request, res:Response, next) => {
    try{
        res.json(await CajasRepo.ObtenerCaja({idCaja: req.params.id }));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al obtener la caja nro ${req.params.id}.`, 500, { modulo: 'cajasRoute.obtener-caja' }, error));
    }
});

// Resumen único de la caja (Fase 3.4-A): cajón, fondo de proveedores, otros medios, info y control.
// Arqueo ciego (3.4-B): un EMPLEADO sin permiso de "ver resumen de caja" no lo puede pedir (403).
// OJO: igual que Reabrir, el usuario viene del header x-usuario-id (el backend todavía no tiene auth real;
// deuda conocida): es un control de operación, no una barrera de seguridad.
router.get('/:id/resumen', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId } = datosAuditoria(req);
        if (await EsArqueoCiego(usuarioId)) {
            throw new AppError(CodigoError.VALIDACION, 'No tenés permiso para ver el resumen de la caja.', 403,
                { modulo: 'cajasRoute.resumen', idCaja: Number(req.params.id) });
        }

        res.json(await ResumenCajaServ.Calcular(Number(req.params.id)));

    } catch(error:any){
        if (error instanceof AppError) return next(error);
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al calcular el resumen de la caja nro ${req.params.id}.`, 500, { modulo: 'cajasRoute.resumen' }, error));
    }
});
//#endregion

//#region ABM
// Cierre con arqueo opcional (Fase 3.4-A). Body: { efectivoContado?: number | null, observacion?: string }.
router.put('/:id/cerrar', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        // Se decide antes de cerrar. Si es ciego, la respuesta no lleva esperado, diferencia ni resumen:
        // que no viajen por la red, no solo que el front no los muestre (mismo criterio que /resumen).
        const ciego = await EsArqueoCiego(usuarioId);
        const cierre = await CierreCajaServ.Cerrar(Number(req.params.id), req.body ?? {}, usuarioId, puestoId);
        res.json(ciego ? { idCierre: cierre.idCierre, contado: cierre.contado } : cierre);

    } catch(error:any){
        if (error instanceof AppError) return next(error);
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al intentar cerrar la caja nro ${req.params.id}.`, 500, { modulo: 'cajasRoute.cerrar' }, error));
    }
});

// Reapertura: solo ADMINISTRADOR/ENCARGADO, con motivo obligatorio. Body: { motivo: string }.
router.put('/:id/reabrir', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await CierreCajaServ.Reabrir(Number(req.params.id), req.body?.motivo, usuarioId, puestoId));

    } catch(error:any){
        if (error instanceof AppError) return next(error);
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al intentar reabrir la caja nro ${req.params.id}.`, 500, { modulo: 'cajasRoute.reabrir' }, error));
    }
});

// TRANSITORIO: lo usa el front viejo hasta que salga la 3.4-B. Cierra sin arqueo / reabre con motivo fijo.
router.put('/finalizar', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await CierreCajaServ.FinalizarCompat(req.body, usuarioId, puestoId));

    } catch(error:any){
        next(new AppError(
            CodigoError.INTERNAL_ERROR,
            'Error al intentar finalizar la caja.',
            500,
            { modulo: 'cajasRoute.finalizar' },
            error
        ));
    }
});

router.post('/agregar', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await CajasRepo.Agregar(req.body, usuarioId, puestoId));

    } catch(error:any){
        next(new AppError(
            CodigoError.INTERNAL_ERROR,
            'Error al intentar agregar una nueva caja.',
            500,
            { modulo: 'cajasRoute.agregar' },
            error
        ));
    }
});

router.put('/modificar', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await CajasRepo.Modificar(req.body, usuarioId, puestoId));

    } catch(error:any){
        // CAJA_CERRADA y similares: se dejan pasar tal cual, envolverlos le esconde el mensaje al usuario.
        if (error instanceof AppError) return next(error);
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al intentar modificar la caja nro ${req.body.id}.`, 500, { modulo: 'cajasRoute.modificar' }, error));
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response, next) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await CajasRepo.Eliminar(req.params.id, usuarioId, puestoId));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, `Error al intentar eliminar la caja nro ${req.params.id}.`, 500, { modulo: 'cajasRoute.eliminar' }, error));
    }
});
//#endregion

// Export the router
export default router; 