import {Router, Request, Response} from 'express';
import logger from '../logger/loggerGeneral';
import { ParametrosRepo } from '../data/parametrosRepository';
import path from 'path';
import fs from 'fs';

const ROOT_DIR = process.cwd();
const UPDATER_DIR                      = path.join(ROOT_DIR, 'updater');
const EVENTO_ACTUALIZACION_FRONT_PATH  = path.join(UPDATER_DIR, 'evento-actualizacion-front.json');
const PENDIENTE_CONFIRMAR_FRONT_PATH   = path.join(UPDATER_DIR, 'pendiente-confirmar-front.json');
const ROLLBACK_FRONT_PENDIENTE_PATH    = path.join(UPDATER_DIR, 'pendiente-rollback-front.json');

const router : Router  = Router();


router.post('/ok', async (req:Request, res:Response) => {
    try{ 
        if(req.body){
            //Actualizamos el aviso de que se actualizo el sistema
            await ParametrosRepo.ActualizarParametro({clave:"actualizado", valor:"true"})
            //Actualizamos localmente la version
            res.json(await ParametrosRepo.ActualizarParametro(req.body));
        }else
            throw {message:"No se proporcionó data"};

    } catch(error:any){
        logger.error("Error al intentar informar la actualización. " + error);
        res.status(500).send(false);
    }
});

/**
 * GET /hay-confirmar-front
 * El frontend lo consulta en cada arranque para saber si debe emitir "booteó OK".
 * Si pendiente-confirmar-front.json existe, significa que el arranque anterior instaló
 * una versión nueva y este es el primer boot exitoso posterior.
 */
router.get('/hay-confirmar-front', (_req: Request, res: Response) => {
    return res.json({ pendiente: fs.existsSync(PENDIENTE_CONFIRMAR_FRONT_PATH) });
});

/**
 * POST /evento-front
 * Recibe el resultado de un intento de update del frontend y lo persiste en updater/.
 *
 * resultado = 'instalando' → escribe pendiente-confirmar-front.json (antes del relaunch).
 * resultado = 'ok'         → escribe evento-actualizacion-front.json + borra pendiente.
 * resultado = 'error'      → escribe evento-actualizacion-front.json + borra pendiente.
 *
 * El heartbeat del backend lee evento-actualizacion-front.json y lo envía a AdminServer.
 */
router.post('/evento-front', (req: Request, res: Response) => {
    const { resultado, versionOrigen, versionActual, error: errorMsg, timestamp } = req.body;

    if (!resultado) {
        return res.status(400).json({ ok: false, error: 'Falta campo resultado' });
    }

    try {
        if (!fs.existsSync(UPDATER_DIR)) {
            fs.mkdirSync(UPDATER_DIR, { recursive: true });
        }

        if (resultado === 'instalando') {
            // Solo marca que hay un update pendiente de confirmar boot.
            // No se envía al AdminServer por heartbeat — sirve como señal interna.
            fs.writeFileSync(PENDIENTE_CONFIRMAR_FRONT_PATH, JSON.stringify({
                versionOrigen: versionOrigen ?? null,
                timestamp:     timestamp ?? new Date().toISOString(),
            }, null, 2));

        } else {
            // ok, error: escribir evento final que el heartbeat enviará a AdminServer.
            fs.writeFileSync(EVENTO_ACTUALIZACION_FRONT_PATH, JSON.stringify({
                resultado:     resultado,
                versionOrigen: versionOrigen ?? null,
                versionActual: versionActual ?? null,
                error:         errorMsg ?? null,
                timestamp:     timestamp ?? new Date().toISOString(),
            }, null, 2));

            // Limpiar pendiente de confirmación si quedó de una instalación anterior.
            if (fs.existsSync(PENDIENTE_CONFIRMAR_FRONT_PATH)) {
                fs.unlinkSync(PENDIENTE_CONFIRMAR_FRONT_PATH);
            }
        }

        return res.json({ ok: true });

    } catch (e: any) {
        logger.error('Error escribiendo evento de actualización de frontend: ' + e.message);
        return res.status(500).json({ ok: false });
    }
});

/**
 * GET /hay-rollback-front
 * El frontend consulta si hay una instrucción de rollback pendiente.
 * Devuelve { pendiente: true, version, zipUrl } o { pendiente: false }.
 */
router.get('/hay-rollback-front', (_req: Request, res: Response) => {
    if (!fs.existsSync(ROLLBACK_FRONT_PENDIENTE_PATH)) {
        return res.json({ pendiente: false });
    }
    try {
        const data = JSON.parse(fs.readFileSync(ROLLBACK_FRONT_PENDIENTE_PATH, 'utf-8'));
        if (!data.version || !data.zipUrl) return res.json({ pendiente: false });
        return res.json({ pendiente: true, version: data.version, zipUrl: data.zipUrl });
    } catch {
        return res.json({ pendiente: false });
    }
});

/**
 * POST /limpiar-rollback-front
 * El frontend lo llama antes de ejecutar el installer de rollback.
 * Se borra ANTES de spawner el NSIS porque la app se cierra durante la instalación
 * y no habría oportunidad de limpiarlo después.
 */
router.post('/limpiar-rollback-front', (_req: Request, res: Response) => {
    try {
        if (fs.existsSync(ROLLBACK_FRONT_PENDIENTE_PATH)) {
            fs.unlinkSync(ROLLBACK_FRONT_PENDIENTE_PATH);
        }
        return res.json({ ok: true });
    } catch (e: any) {
        logger.error('Error limpiando rollback de frontend: ' + e.message);
        return res.status(500).json({ ok: false });
    }
});

// Export the router
export default router;