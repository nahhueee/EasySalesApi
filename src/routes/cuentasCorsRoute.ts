import {CuentasRepo} from '../data/cuentasCorsRepository';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
const router : Router  = Router();

router.post('/movimientos', async (req:Request, res:Response) => {
    try{
        res.json(await CuentasRepo.ObtenerMovimientos(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de movimientos de la cuenta corriente.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/cobros-caja/:idCaja', async (req:Request, res:Response) => {
    try{
        res.json(await CuentasRepo.ObtenerCobrosCaja(Number(req.params.idCaja)));

    } catch(error:any){
        let msg = "Error al obtener los cobros de fiado de la caja nro " + req.params.idCaja + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-deuda/:idCliente', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ObtenerDeudaTotalCliente(req.params.idCliente));

    } catch(error:any){
        let msg = "Error al obtener la deuda de el cliente nro " + req.params.idCliente + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Saldo actual del ledger (cuenta_corriente_movimientos) para un cliente.
// < 0 = saldo a favor; > 0 = deuda. Usado en registrar-venta para validar tope de SAF.
router.get('/saldo-ledger/:idCliente', async (req:Request, res:Response) => {
    try{
        const saldo = await CuentasRepo.ObtenerSaldoLedger(Number(req.params.idCliente));
        res.json({ saldo });

    } catch(error:any){
        let msg = "Error al obtener el saldo del ledger del cliente nro " + req.params.idCliente + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/entrega', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.EntregaDinero(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar el proceso de entrega de dinero.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/revertir-entrega', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.RevertirEntregaDinero(req.body));

    } catch(error:any){
        let msg = "No se pudo realizar la reversión de la última entrega.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/actualizar-pago', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.ActualizarEstadoPago(req.body));

    } catch(error:any){
        let msg = "No se pudo actualizar el estado de pago.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
router.get('/revertir-pago/:idVenta', async (req:Request, res:Response) => {
    try{ 
        res.json(await CuentasRepo.RevertirEstadoPago(req.params.idVenta));

    } catch(error:any){
        let msg = "No se pudo revertir el pago de la venta.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
// Export the router
export default router; 