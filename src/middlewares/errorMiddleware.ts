import { logger } from "../log/logger";
import { AppError } from "../log/AppError";

type Severity = 'INFO' | 'WARN' | 'ERROR';

export function errorMiddleware(err, req, res, next) {
  const isAppError = err instanceof AppError;

  const status = err.status || 500;
  const severity = getSeverity(status);

  logger.error({
    type: isAppError ? 'APP_ERROR' : 'UNHANDLED_ERROR',
    code: err.code || 'INTERNAL_ERROR',
    message: err.message,
    severity: severity,
    status: status,
    route: req.originalUrl,
    method: req.method,
    context: err.context,
    cause: err.cause?.message,
    stack: err.stack
  });

  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: isAppError
        ? err.message
        : 'Error interno del servidor'
    }
  });
}

function getSeverity(status?: number): Severity {
  if (!status) return 'ERROR';
  if (status >= 500) return 'ERROR';
  if (status >= 400) return 'WARN';
  return 'INFO';
}

