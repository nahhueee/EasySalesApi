import {VentasRepo} from '../data/ventasRepository';
import {FacturacionServ} from '../services/facturacionService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
const router : Router  = Router();

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de ventas de la caja.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector-tpagos', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.TiposPagoSelector());

    } catch(error:any){
        let msg = "Error al obtener el selector de tipos de pago.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/totales-tipo-pago/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.TotalesXTipoPago(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener los totales por tipo de pago para el resumen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/totales-pagas-impagas/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.TotalesPagasImpagas(req.params.id));

    } catch(error:any){
        let msg = "Error al obtener los totales de ventas paga e impagas para el resumen.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/guardar-factura', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.GuardarFactura(req.body));

    } catch(error:any){
        let msg = "Error al intentar guardar los datos de facturacion para la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/eliminar', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.Eliminar(req.body));

    } catch(error:any){
        let msg = "Error al intentar eliminar la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region FACTURA
router.get('/obtenerQR/:id', async (req:Request, res:Response) => {
    try{ 
        res.json(await FacturacionServ.ObtenerQRFactura(req.params.id));
    } catch(error:any){
        let msg = "Error al intentar obtener el qr de la factura.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/facturar', async (req:Request, res:Response) => {
    try{ 
        res.json(await FacturacionServ.Facturar(req.body));

    } catch(error:any){
        let msg = "Error al intentar facturar el comprobante.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 