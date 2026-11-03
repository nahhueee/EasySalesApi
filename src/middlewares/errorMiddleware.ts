import { logger } from "../logger/logger";
import { AppError } from "../logger/AppError";
import { CodigoError } from "../logger/CodigosError";
import { esDeadlock, MENSAJE_CONCURRENCIA } from "../utils/concurrencia";

/**
 * Middleware central de manejo de errores.
 *
 * Responsabilidad única: loguear el error estructurado y devolver la respuesta HTTP.
 * El encolado a AdminServer lo hace ErrorBatchTransport automáticamente
 * al interceptar logger.error, basándose en la severidad del código.
 * La severidad se auto-inyecta en el logger desde el mapa de CodigosError.
 */
export function errorMiddleware(err, req, res, next) {
  // Deadlock (1213): se informa como conflicto 409 en vez de un 500 genérico (Fase 3.4-A, A1).
  if ((esDeadlock(err) || esDeadlock(err?.cause)) && err.code !== CodigoError.OPERACION_CONCURRENTE) {  // las rutas envuelven el error original en `cause`
    err = new AppError(CodigoError.OPERACION_CONCURRENTE, MENSAJE_CONCURRENCIA, 409, err.context, err);
  }

  const isAppError = err instanceof AppError;
  const status     = err.status || 500;

  logger.error({
    type:    isAppError ? 'APP_ERROR' : 'UNHANDLED_ERROR',
    code:    err.code || 'INTERNAL_ERROR',
    message: err.message,
    status,
    route:   req.originalUrl,
    method:  req.method,
    context: err.context,
    cause:   err.cause?.message,
    stack:   err.stack,
  });

  res.status(status).json({
    code:    err.code    || 'INTERNAL_ERROR',
    message: isAppError ? err.message : 'Error interno del servidor',
  });
}
