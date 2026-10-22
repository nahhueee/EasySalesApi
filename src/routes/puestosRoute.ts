import { Router, Request, Response, NextFunction } from 'express';
import { PuestosRepo } from '../data/puestosRepository';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { esUuidV4, esLoopback, ipDeRequest, puestoIdDeRequest } from '../utils/puestos';

// Fase 3.2-A (ver documentos/handoff_fase3_2a_puestos.md). Sin Zod (llega en Fase 4):
// validación manual y explícita.
const router: Router = Router();

const MAX_NOMBRE = 60;

/** String opcional recortado al largo de la columna; cualquier otra cosa => null. */
const textoOpcional = (valor: unknown, max: number): string | null => {
    if (typeof valor !== 'string') return null;
    const limpio = valor.trim().slice(0, max);
    return limpio === '' ? null : limpio;
};

// El id sale del header X-Puesto-Id. esServidor lo decide el backend (loopback), no el front.
router.post('/registrar', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = puestoIdDeRequest(req);
        if (!id) {
            throw new AppError(CodigoError.VALIDACION, 'Header X-Puesto-Id ausente o inválido.', 400);
        }

        await PuestosRepo.Registrar({
            id,
            hostname:     textoOpcional(req.body?.hostname, 100),
            so:           textoOpcional(req.body?.so, 100),
            versionFront: textoOpcional(req.body?.versionFront, 20),
            ip:           ipDeRequest(req),
            esServidor:   esLoopback(req),
        });
        res.json("OK");

    } catch (error: any) {
        next(error);
    }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
        res.json(await PuestosRepo.Obtener());
    } catch (error: any) {
        next(error);
    }
});

router.put('/:id/nombre', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const id = req.params.id;
        if (!esUuidV4(id)) {
            throw new AppError(CodigoError.VALIDACION, 'Id de puesto inválido.', 400);
        }

        const nombre = req.body?.nombre;
        if (typeof nombre !== 'string') {
            throw new AppError(CodigoError.VALIDACION, "El campo 'nombre' es requerido y debe ser texto.", 400);
        }
        if (nombre.trim().length > MAX_NOMBRE) {
            throw new AppError(CodigoError.VALIDACION, `El nombre no puede superar los ${MAX_NOMBRE} caracteres.`, 400);
        }

        const existe = await PuestosRepo.Renombrar(id.toLowerCase(), nombre);
        if (!existe) {
            throw new AppError(CodigoError.VALIDACION, 'El puesto no existe.', 404);
        }
        res.json("OK");

    } catch (error: any) {
        next(error);
    }
});

export default router;
