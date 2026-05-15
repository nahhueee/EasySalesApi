import {VentasRepo} from '../data/ventasRepository';
import {FacturacionServ} from '../services/facturacionService';
import {Router, Request, Response} from 'express';
//import logger from '../log/loggerGeneral';
import {logger} from '../logger/logger'
import { TerminalServ } from '../services/terminalService';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.Obtener(req.body));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener el listado de ventas.', 500, { modulo: 'ventasRoute.obtener' }, error));
    }
});

router.get('/selector-tpagos', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.TiposPagoSelector());

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener el selector de tipos de pago.', 500, { modulo: 'ventasRoute.selector-tpagos' }, error));
    }
});

router.get('/totales-tipo-pago/:id', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.TotalesXTipoPago(req.params.id));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener los totales por tipo de pago.', 500, { modulo: 'ventasRoute.totales-tipo-pago' }, error));
    }
});

router.get('/totales-pagas-impagas/:id', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.TotalesPagasImpagas(req.params.id));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al obtener los totales de ventas pagas/impagas.', 500, { modulo: 'ventasRoute.totales-pagas-impagas' }, error));
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.Agregar(req.body));

    } catch(error:any){
        next(new AppError(
            CodigoError.INTERNAL_ERROR,
            'Error al intentar agregar la venta.',
            500,
            { modulo: 'ventasRoute.agregar' },
            error
        ));
    }
});

router.post('/guardar-factura', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.GuardarFactura(req.body));

    } catch(error:any){
        next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al guardar los datos de facturación para la venta.', 500, { modulo: 'ventasRoute.guardar-factura' }, error));
    }
});

router.put('/eliminar', async (req:Request, res:Response, next) => {
    try{
        res.json(await VentasRepo.Eliminar(req.body.venta, req.body.observacion));

    } catch(error:any){
        next(new AppError(
            CodigoError.INTERNAL_ERROR,
            'Error al intentar eliminar la venta.',
            500,
            { modulo: 'ventasRoute.eliminar' },
            error
        ));
    }
});
//#endregion

//#region FACTURA
router.get('/obtenerQR/:id', async (req:Request, res:Response, next) => {
    try{
        res.json(await FacturacionServ.ObtenerQRFactura(req.params.id));
    } catch(error:any){
        next(new AppError(CodigoError.QR_ERROR, 'Error al obtener el QR de la factura.', 500, { modulo: 'ventasRoute.obtenerQR' }, error));
    }
});

router.post('/facturar', async (req:Request, res:Response, next) => {
    try{ 
        //Validamos permisos
        await TerminalServ.VerificarTerminalHabilitada();

        res.json(await FacturacionServ.Facturar(req.body));
    } catch(error){
        next(error);
    }
});
//#endregion

// Export the router
export default router; 