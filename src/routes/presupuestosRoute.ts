import { PresupuestosRepo } from '../data/presupuestosRepository';
import { Router, Request, Response } from 'express';
import { logger } from '../logger/logger';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { ParametrosRepo } from '../data/parametrosRepository';
import { ComprobanteService } from '../services/comprobanteService';
import { v4 as uuid } from 'uuid';

const router: Router = Router();
const ComprobanteServ = new ComprobanteService();
const printer = require('pdf-to-printer');
const fs = require('fs');
const path = require('path');

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

//#region PDF
// El backend resuelve presupuesto + detalle por id (no confía en el payload del cliente),
// siguiendo el mismo patrón de generación/impresión que filesRoute usa para comprobantes de venta.
// POST (no GET) porque ApiService solo soporta responseType 'blob' en post() — el frontend
// no necesita enviar body, pero la respuesta debe llegar como blob para abrir el PDF en el navegador.
router.post('/ver-pdf/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const presupuesto = await PresupuestosRepo.ObtenerPorId(id);

        if (!presupuesto) {
            res.status(404).send('Presupuesto no encontrado.');
            return;
        }

        const detalles = await PresupuestosRepo.ObtenerDetalle(id);
        const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
        const pdfBuffer = await ComprobanteServ.generarPresupuestoPDF(presupuesto, detalles, parametrosImpresion);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename=presupuesto.pdf');
        res.send(pdfBuffer);

    } catch (error: any) {
        const msg = 'Error al generar el PDF del presupuesto.';
        logger.error(msg + ' ' + error.message);
        res.status(500).send(msg);
    }
});

router.post('/imprimir-pdf/:id', async (req: Request, res: Response) => {
    try {
        const id = parseInt(req.params.id);
        const presupuesto = await PresupuestosRepo.ObtenerPorId(id);

        if (!presupuesto) {
            res.status(404).send('Presupuesto no encontrado.');
            return;
        }

        const detalles = await PresupuestosRepo.ObtenerDetalle(id);
        const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();
        const pdfBuffer = await ComprobanteServ.generarPresupuestoPDF(presupuesto, detalles, parametrosImpresion);

        // Crear archivo temporal
        const tempName = `impresion_${uuid()}.pdf`;
        const tempPath = path.join(__dirname, '..', 'temp', tempName);

        fs.writeFileSync(tempPath, pdfBuffer);

        // Enviar a la impresora configurada
        await printer.print(tempPath, {
            printer: parametrosImpresion.impresora,
            orientation: 'portrait',
            scale: 'noscale'
        });

        // Eliminar archivo temporal
        fs.unlinkSync(tempPath);

        res.status(200).json('OK');

    } catch (error: any) {
        const msg = 'Error al imprimir el presupuesto.';
        logger.error(msg + ' ' + error.message);
        res.status(500).send(msg);
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
