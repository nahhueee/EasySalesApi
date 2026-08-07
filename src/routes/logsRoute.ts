import { Router, Request, Response, NextFunction } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { logger } from '../logger/logger';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';

const router: Router = Router();

interface EntradaLog {
  timestamp: string;
  level: string;
  code?: string;
  message: string;
  severity?: string;
  type?: string;
  route?: string;
  method?: string;
  status?: number;
  context?: Record<string, any>;
  cause?: string;
  stack?: string;
  modulo?: string;
}

// Lee todas las líneas del error.log y las parsea
async function leerEntradas(): Promise<EntradaLog[]> {
  const rutaLog = path.resolve(__dirname, '../log/error.log');

  // Si el archivo no existe todavía, devolvemos lista vacía
  if (!fs.existsSync(rutaLog)) return [];

  const fileStream = fs.createReadStream(rutaLog);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const entradas: EntradaLog[] = [];

  for await (const linea of rl) {
    try {
      const log = JSON.parse(linea);
      entradas.push({
        timestamp: log.timestamp,
        level:     log.level,
        code:      log.code,
        message:   log.message,
        severity:  log.severity,
        type:      log.type,
        route:     log.route,
        method:    log.method,
        status:    log.status,
        context:   log.context,
        // cause puede venir como string directo o dentro de context
        cause:     log.cause ?? log.context?.cause,
        stack:     log.stack,
        modulo:    log.modulo,
      });
    } catch {
      // línea no parseable — se ignora silenciosamente
    }
  }

  return entradas;
}

// GET /logs — devuelve entradas con soporte de filtros y paginación
// Query params: limit, offset, severity (CRITICA|ALTA|MEDIA|BAJA), code
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit  = Math.min(parseInt(String(req.query.limit  ?? 50), 10), 200);
    const offset = parseInt(String(req.query.offset ?? 0), 10);
    const severityFiltro = req.query.severity ? String(req.query.severity).toUpperCase().split(',') : [];
    const codeFiltro     = req.query.code     ? String(req.query.code).toUpperCase() : '';

    let entradas = await leerEntradas();

    // Más recientes primero
    entradas.reverse();

    if (severityFiltro.length > 0) {
      entradas = entradas.filter(e => {
        if (severityFiltro.includes('SIN_CODIGO')) {
          if (!e.code) return true;
        }
        return e.severity && severityFiltro.includes(e.severity.toUpperCase());
      });
    }

    if (codeFiltro) {
      entradas = entradas.filter(e => e.code?.toUpperCase() === codeFiltro);
    }

    res.json({
      total: entradas.length,
      datos: entradas.slice(offset, offset + limit),
    });

  } catch (error) {
    next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al leer el log de errores', 500, { modulo: 'logsRoute', metodo: 'GET /' }));
  }
});

// DELETE /logs — limpia el error.log
router.delete('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rutaLog = path.resolve(__dirname, '../log/error.log');

    // Truncamos el archivo preservando la ruta — el logger de Winston
    // sigue escribiendo en el mismo file descriptor
    fs.writeFileSync(rutaLog, '');

    res.json('OK');

  } catch (error) {
    next(new AppError(CodigoError.INTERNAL_ERROR, 'Error al limpiar el log de errores', 500, { modulo: 'logsRoute', metodo: 'DELETE /' }));
  }
});

// POST /logs/front — recibe errores capturados por el ErrorHandler global de
// Angular (excepciones de JS/framework, NO respuestas HTTP: esas ya quedan
// logueadas server-side por errorMiddleware cuando ocurren).
// Flujo "background" documentado en AppError.ts: logueamos directo con
// logger.error() en vez de lanzar un AppError + next(), porque esto no es un
// error de ESTE request — es un ack de que se registró el error del cliente.
// Devolver 500 acá confundiría al front (que llama a este mismo endpoint
// para reportar errores).
router.post('/front', (req: Request, res: Response) => {
  const { message, context, stack } = req.body ?? {};

  if (!message || typeof message !== 'string') {
    res.status(400).json({ message: 'message es requerido' });
    return;
  }

  // Trazabilidad: qué terminal/usuario disparó el error (mismos headers de
  // auditoría que setea api.service.ts en el front, ver headersAuditoria()).
  const puestoId  = req.header('X-Puesto-Id')  ?? undefined;
  const usuarioId = req.header('X-Usuario-Id') ?? undefined;

  // NO seteamos route/method con datos de ESTE request (POST /logs/front):
  // esos campos son para la ruta del backend donde ocurrió el error, y acá
  // siempre sería este mismo endpoint de reporte — dato inútil y engañoso.
  // Si el front quiere indicar en qué pantalla ocurrió, va dentro de context.
  logger.error({
    type:    'FRONT_ERROR',
    code:    CodigoError.FRONT_ERROR,
    message,
    context: { ...(context ?? {}), puestoId, usuarioId },
    stack:   typeof stack === 'string' ? stack : undefined,
  });

  res.status(201).json({ ok: true });
});


// Export the router
export default router; 