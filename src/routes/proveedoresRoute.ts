import {ProveedoresRepo} from '../data/proveedoresRepository';
import {ProveedorCuentaRepo} from '../data/proveedorCuentaRepository';
import {PadronServ} from '../services/padronService';
import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import { datosAuditoria } from '../utils/auditoria';
import { TienePermisoBackend, PuedeRegistrarPagoProveedor } from '../utils/permisos';
import { ID_TIPO_PAGO_EFECTIVO } from '../data/cuentasCorsRepository';
const router : Router  = Router();

const ROLES_PAGOS_PROVEEDOR = ["ADMINISTRADOR", "ENCARGADO"];

//#region OBTENER
router.post('/obtener', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.Obtener(req.body));

    } catch(error:any){
        let msg = "Error al obtener el listado de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/obtener-proveedor/:id', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.ObtenerProveedor({idProveedor: req.params.id }));

    } catch(error:any){
        let msg = "Error al obtener el proveedor nro " + req.params.id + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/selector', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.Selector());

    } catch(error:any){
        let msg = "Error al obtener el selector de proveedores.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Saldo actual del ledger para un proveedor. saldo > 0 = le debo; saldo < 0 = pagué de más.
// Lo usa el diálogo de pago para el aviso "este proveedor no tiene deuda registrada".
router.get('/saldo/:idProveedor', async (req:Request, res:Response) => {
    try{
        const saldo = await ProveedorCuentaRepo.ObtenerSaldo(Number(req.params.idProveedor));
        res.json({ saldo });

    } catch(error:any){
        let msg = "Error al obtener el saldo del proveedor nro " + req.params.idProveedor + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
// Disponible del fondo de proveedores de una caja puntual (fondoProveedores − pagado). Lo usa
// el diálogo de pago para mostrarle a un EMPLEADO cuánto puede pagar sin autorización antes de
// que lo rechace el backend. null = la caja no tiene fondo asignado.
router.get('/disponible-fondo/:idCaja', async (req:Request, res:Response) => {
    try{
        const disponible = await ProveedorCuentaRepo.ObtenerDisponibleFondo(Number(req.params.idCaja));
        res.json({ disponible });

    } catch(error:any){
        let msg = "Error al obtener el disponible del fondo de proveedores de la caja nro " + req.params.idCaja + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.Agregar(req.body));

    } catch(error:any){
        let msg = "Error al intentar agregar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/modificar', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.Modificar(req.body));

    } catch(error:any){
        let msg = "Error al intentar modificar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.delete('/eliminar/:id', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedoresRepo.Eliminar(req.params.id));

    } catch(error:any){
        let msg = "Error al intentar eliminar el proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region PAGOS (Fase 2, PR6 — único bloque que mueve plata y toca el arqueo)
router.post('/pagar', async (req:Request, res:Response) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);

        // Guard de rol en el backend: no alcanza con que el front oculte el botón, un pago
        // mueve plata real. ADMINISTRADOR/ENCARGADO sin límite; EMPLEADO solo hasta el
        // disponible del fondo de proveedores DE ESA CAJA (decisión 2026-08-10, corregida el
        // mismo día — ver utils/permisos.ts). Mismo guard de efectivo que RegistrarPago: no
        // confiar en idCaja si el medio de pago no es EFECTIVO.
        const monto = Number(req.body.monto);
        const idCajaEfectivo = (Number(req.body.idTipoPago) === ID_TIPO_PAGO_EFECTIVO && req.body.idCaja)
            ? Number(req.body.idCaja)
            : null;
        const { permitido, motivo } = await PuedeRegistrarPagoProveedor(usuarioId, monto, idCajaEfectivo);
        if (!permitido) {
            res.status(403).send(motivo);
            return;
        }

        res.json(await ProveedorCuentaRepo.RegistrarPago(req.body, usuarioId, puestoId));

    } catch(error:any){
        let msg = "Error al intentar registrar el pago a proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/anular-pago', async (req:Request, res:Response) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);

        const tienePermiso = await TienePermisoBackend(usuarioId, ROLES_PAGOS_PROVEEDOR);
        if (!tienePermiso) {
            res.status(403).send("No tenés permiso para anular pagos a proveedores.");
            return;
        }

        res.json(await ProveedorCuentaRepo.AnularPago(req.body, usuarioId, puestoId));

    } catch(error:any){
        let msg = "Error al intentar anular el pago a proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region CUENTA / LIBRETA (Fase 3, PR7 — no mueve plata, solo visibilidad sobre el ledger)
// Mismo patrón que cuentasCorsRoute.ts POST /movimientos: filtro paginado por body, no por
// querystring, para no tener que serializar los chips de filtro a mano.
router.post('/cuenta/movimientos', async (req:Request, res:Response) => {
    try{
        res.json(await ProveedorCuentaRepo.ObtenerMovimientos(req.body));

    } catch(error:any){
        let msg = "Error al obtener los movimientos de la cuenta del proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.get('/cuenta/proximo-vencimiento/:idProveedor', async (req:Request, res:Response) => {
    try{
        const fechaVencimiento = await ProveedorCuentaRepo.ObtenerProximoVencimiento(Number(req.params.idProveedor));
        res.json({ fechaVencimiento });

    } catch(error:any){
        let msg = "Error al obtener el próximo vencimiento del proveedor nro " + req.params.idProveedor + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.post('/factura', async (req:Request, res:Response) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);
        res.json(await ProveedorCuentaRepo.RegistrarFactura(req.body, usuarioId, puestoId));

    } catch(error:any){
        let msg = "Error al intentar registrar la factura de proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Cuántos pagos no anulados quedaron imputados a esta factura. El front lo consulta antes de
// abrir el modal de confirmación de anular-factura, para mostrar el aviso correspondiente.
router.get('/factura-pagos-imputados/:idMovimiento', async (req:Request, res:Response) => {
    try{
        const cantidad = await ProveedorCuentaRepo.ContarPagosImputados(Number(req.params.idMovimiento));
        res.json({ cantidad });

    } catch(error:any){
        let msg = "Error al verificar los pagos imputados a la factura nro " + req.params.idMovimiento + ".";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

router.put('/anular-factura', async (req:Request, res:Response) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);

        const tienePermiso = await TienePermisoBackend(usuarioId, ROLES_PAGOS_PROVEEDOR);
        if (!tienePermiso) {
            res.status(403).send("No tenés permiso para anular facturas de proveedores.");
            return;
        }

        res.json(await ProveedorCuentaRepo.AnularFactura(req.body, usuarioId, puestoId));

    } catch(error:any){
        let msg = "Error al intentar anular la factura de proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});

// Ajuste manual del saldo (documentos/plan_proveedores.md §5): corrige una deuda inicial mal
// cargada, una diferencia de redondeo o una NC informal del proveedor. Mismo rol que
// anular-pago/anular-factura: quien puede corregir el ledger a mano, no cualquiera.
router.post('/ajuste', async (req:Request, res:Response) => {
    try{
        const { usuarioId, puestoId } = datosAuditoria(req);

        const tienePermiso = await TienePermisoBackend(usuarioId, ROLES_PAGOS_PROVEEDOR);
        if (!tienePermiso) {
            res.status(403).send("No tenés permiso para registrar ajustes de proveedores.");
            return;
        }

        res.json(await ProveedorCuentaRepo.RegistrarAjuste(req.body, usuarioId, puestoId));

    } catch(error:any){
        let msg = "Error al intentar registrar el ajuste de proveedor.";
        logger.error(msg + " " + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region PADRON AFIP
// Mismo endpoint que usa Clientes (PadronServ.ConsultarContribuyente): la consulta es al
// padrón de ARCA por CUIT, no depende de si el sujeto consultado es cliente o proveedor.
router.get('/consulta-padron/:cuit', async (req:Request, res:Response, next) => {
    try{
        res.json(await PadronServ.ConsultarContribuyente(req.params.cuit));

    } catch(error){
        next(error);
    }
});
//#endregion

// Export the router
export default router;
