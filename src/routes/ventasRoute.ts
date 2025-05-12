import {VentasRepo} from '../data/ventasRepository';
import {FacturacionServ} from '../services/facturacionService';
import {Router, Request, Response} from 'express';
import logger from '../log/loggerGeneral';
import { ParametrosRepo } from '../data/parametrosRepository';
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

//#region OTROS
router.get('/ticket-factura/:id', async (req:Request, res:Response) => {
    try{ 
        const objComprobante = await VentasRepo.ObtenerDatosTicketFactura(req.params.id);
        const datosFacturacion = await ParametrosRepo.ObtenerParametrosFacturacion();

        objComprobante.cuit = datosFacturacion.cuit;
        objComprobante.direccion = datosFacturacion.direccion

        if(datosFacturacion.condicion == 'responsable_inscripto'){
            objComprobante.condicion = "Responsable Inscripto";
        }else{
            objComprobante.condicion = "Monotributista";
        }

        res.json(objComprobante);

    } catch(error:any){
        let msg = "Error al intentar obtener los datos de la factura.";
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

router.put('/entrega', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.EntregaDinero(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar el proceso de entrega de dinero.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-pago', async (req:Request, res:Response) => {
    try{ 
        res.json(await VentasRepo.ActualizarEstadoPago(req.body));

    } catch(error:any){
        let msg = "No se pudo actualizar el estado de pago.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

// Export the router
export default router; 