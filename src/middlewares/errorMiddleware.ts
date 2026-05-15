import { logger } from "../logger/logger";
import { AppError } from "../logger/AppError";

type Severity = 'INFO' | 'WARN' | 'ERROR';

/**
 * Middleware central de manejo de errores.
 *
 * Responsabilidad única: loguear el error estructurado y devolver la respuesta HTTP.
 * El encolado a AdminServer lo hace ErrorBatchTransport automáticamente
 * al interceptar logger.error, basándose en la severidad del código.
 */
export function errorMiddleware(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const status     = err.status || 500;

  logger.error({
    type:     isAppError ? 'APP_ERROR' : 'UNHANDLED_ERROR',
    code:     err.code || 'INTERNAL_ERROR',
    message:  err.message,
    severity: getSeverity(status),
    status,
    route:    req.originalUrl,
    method:   req.method,
    context:  err.context,
    cause:    err.cause?.message,
    stack:    err.stack,
  });

  res.status(status).json({
    code:    err.code    || 'INTERNAL_ERROR',
    message: isAppError ? err.message : 'Error interno del servidor',
  });
}

function getSeverity(status?: number): Severity {
  if (!status)       return 'ERROR';
  if (status >= 500) return 'ERROR';
  if (status >= 400) return 'WARN';
  return 'INFO';
}
