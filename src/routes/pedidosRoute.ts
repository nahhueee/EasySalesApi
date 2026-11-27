import { PedidosRepo } from '../data/pedidosRepository';
import { Router, Request, Response } from 'express';
import { logger } from '../logger/logger';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { ParametrosRepo } from '../data/parametrosRepository';
import { ComprobanteService } from '../services/comprobanteService';
import { auditoriaDesdeRequest } from '../utils/auditoria';
import { ImpresionTermicaServ } from '../services/impresionTermicaService';
import { v4 as uuid } from 'uuid';

const router: Router = Router();
const ComprobanteServ = new ComprobanteService();
const fs = require('fs');
const path = require('path');

// Los errores de negocio ya vienen como AppError desde el repo (mensaje claro para el usuario): se dejan
// pasar tal cual. Cualquier otra cosa es un error inesperado y se envuelve en el genérico.
function responderError(error: any, next: any, mensaje: string, modulo: string) {
    if (error instanceof AppError) return next(error);
    next(new AppError(CodigoError.INTERNAL_ERROR, mensaje, 500, { modulo }, error));
}

//#region OBTENER
router.post('/obtener', async (req: Request, res: Response, next) => {
    try {
        res.json(await PedidosRepo.Obtener(req.body));
    } catch (error: any) {
        responderError(error, next, 'Error al obtener los pedidos.', 'pedidosRoute.obtener');
    }
});

router.get('/detalle/:id', async (req: Request, res: Response, next) => {
    try {
        res.json(await PedidosRepo.ObtenerDetalle(parseInt(req.params.id)));
    } catch (error: any) {
        responderError(error, next, 'Error al obtener el detalle del pedido.', 'pedidosRoute.detalle');
    }
});

router.get('/historial/:id', async (req: Request, res: Response, next) => {
    try {
        res.json(await PedidosRepo.ObtenerHistorial(parseInt(req.params.id)));
    } catch (error: any) {
        responderError(error, next, 'Error al obtener el historial del pedido.', 'pedidosRoute.historial');
    }
});

router.get('/pagos/:id', async (req: Request, res: Response, next) => {
    try {
        res.json(await PedidosRepo.ObtenerPagos(parseInt(req.params.id)));
    } catch (error: any) {
        responderError(error, next, 'Error al obtener los pagos del pedido.', 'pedidosRoute.pagos');
    }
});
//#endregion

//#region PDF
// Mismo patrón que presupuestosRoute: el backend resuelve pedido + detalle por id (no confía en el payload del
// cliente). POST porque ApiService solo soporta responseType 'blob' en post().
router.post('/ver-pdf/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const pedido = await PedidosRepo.ObtenerPorId(id);

        if (!pedido) {
            res.status(404).send('Pedido no encontrado.');
            return;
        }

        const detalles = await PedidosRepo.ObtenerDetalle(id);
        const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
        const pdfBuffer = await ComprobanteServ.generarPedidoPDF(pedido, detalles, parametrosImpresion);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=pedido.pdf');
        res.send(pdfBuffer);

    } catch (error: any) {
        const msg = 'Error al generar el PDF del pedido.';
        logger.error(msg + ' ' + error.message);
        res.status(500).send(msg);
    }
});

router.post('/imprimir-pdf/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const pedido = await PedidosRepo.ObtenerPorId(id);

        if (!pedido) {
            res.status(404).send('Pedido no encontrado.');
            return;
        }

        const detalles = await PedidosRepo.ObtenerDetalle(id);
        const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
        const pdfBuffer = await ComprobanteServ.generarPedidoPDF(pedido, detalles, parametrosImpresion);

        // Enviar a la impresora configurada (driver o ESC/POS; el servicio maneja el temporal)
        await ImpresionTermicaServ.imprimirPDF(pdfBuffer, parametrosImpresion, parametrosImpresion.papel);

        res.status(200).json('OK');

    } catch (error: any) {
        const msg = 'Error al imprimir el pedido.';
        logger.error(msg + ' ' + error.message);
        res.status(500).send(msg);
    }
});
//#endregion

//#region ABM
router.post('/agregar', async (req: Request, res: Response, next) => {
    try {
        const id = await PedidosRepo.Agregar(req.body, auditoriaDesdeRequest(req));
        res.json({ id });
    } catch (error: any) {
        responderError(error, next, 'Error al guardar el pedido.', 'pedidosRoute.agregar');
    }
});

router.put('/editar/:id', async (req: Request, res: Response, next) => {
    try {
        await PedidosRepo.Editar(parseInt(req.params.id), req.body, auditoriaDesdeRequest(req));
        res.json('OK');
    } catch (error: any) {
        responderError(error, next, 'Error al editar el pedido.', 'pedidosRoute.editar');
    }
});

router.put('/estado/:id', async (req: Request, res: Response, next) => {
    try {
        await PedidosRepo.CambiarEstado(parseInt(req.params.id), req.body?.estado, req.body?.observacion, auditoriaDesdeRequest(req));
        res.json('OK');
    } catch (error: any) {
        responderError(error, next, 'Error al cambiar el estado del pedido.', 'pedidosRoute.estado');
    }
});

router.put('/cancelar/:id', async (req: Request, res: Response, next) => {
    try {
        await PedidosRepo.Cancelar(parseInt(req.params.id), req.body?.motivo, auditoriaDesdeRequest(req),
            { destinoSenia: req.body?.destinoSenia, idCaja: req.body?.idCaja });
        res.json('OK');
    } catch (error: any) {
        responderError(error, next, 'Error al cancelar el pedido.', 'pedidosRoute.cancelar');
    }
});

router.post('/pagos/:id', async (req: Request, res: Response, next) => {
    try {
        const idPago = await PedidosRepo.RegistrarPago(parseInt(req.params.id), req.body, auditoriaDesdeRequest(req));
        res.json({ id: idPago });
    } catch (error: any) {
        responderError(error, next, 'Error al registrar el pago del pedido.', 'pedidosRoute.registrarPago');
    }
});

router.put('/pagos/anular/:idPago', async (req: Request, res: Response, next) => {
    try {
        await PedidosRepo.AnularPago(parseInt(req.params.idPago), auditoriaDesdeRequest(req));
        res.json('OK');
    } catch (error: any) {
        responderError(error, next, 'Error al anular el pago del pedido.', 'pedidosRoute.anularPago');
    }
});
//#endregion

export default router;
