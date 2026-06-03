import { logger } from "../logger/logger";
import { AppError } from "../logger/AppError";

/**
 * Middleware central de manejo de errores.
 *
 * Responsabilidad única: loguear el error estructurado y devolver la respuesta HTTP.
 * El encolado a AdminServer lo hace ErrorBatchTransport automáticamente
 * al interceptar logger.error, basándose en la severidad del código.
 * La severidad se auto-inyecta en el logger desde el mapa de CodigosError.
 */
export function errorMiddleware(err, req, res, next) {
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
