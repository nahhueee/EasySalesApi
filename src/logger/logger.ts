import winston from 'winston';
import path from 'path';
import { debeEnviar } from './CodigosError';

const timezoned = () =>
  new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
});

/**
 * Transport que intercepta logger.error y encola automáticamente en
 * ErrorBatchService si el código tiene severidad MEDIA o superior.
 *
 * Usa lazy require para evitar la dependencia circular:
 *   logger → ErrorBatchService → logger
 *
 * Es fire-and-forget: no bloquea el pipeline de logging.
 */
class ErrorBatchTransport extends winston.Transport {
  constructor() {
    super({ level: 'error' });
  }

  log(info: any, callback: () => void): void {
    callback(); // señal inmediata al pipeline — no bloqueamos

    if (!info?.code || !debeEnviar(info.code)) return;

    setImmediate(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ErrorBatchServ } = require('../services/errorBatchService');
        ErrorBatchServ.registrar(info.code, info.message ?? '');
      } catch {
        // Silencioso: no lanzar desde dentro del transport de logging
      }
    });
  }
}

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

  format: winston.format.combine(
    winston.format.timestamp({ format: timezoned }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),

  transports: [
    // Consola (solo mensaje)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        consoleFormat
      )
    }),
    // Archivo (JSON completo)
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/error.log'),
      level: 'error'
    }),
    // Encolado automático a AdminServer por severidad
    new ErrorBatchTransport(),
  ]
});
