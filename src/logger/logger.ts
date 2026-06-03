import winston from 'winston';
import Transport from 'winston-transport';
import path from 'path';

import { debeEnviar, SEVERIDAD, CodigoError } from './CodigosError';

const timezoned = () =>
  new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires'
  });

const consoleFormat = winston.format.printf(
  ({ level, message, timestamp }) => {
    return `${timestamp} [${level}] ${message}`;
  }
);

/**
 * Normaliza el patrón `logger.error({ code, message, ... })`.
 *
 * Winston trata el primer argumento de logger[level]() como `info.message`.
 * Si se le pasa un objeto plano en lugar de un string, el objeto queda
 * serializado como `"message": { ... }` en el log, enterrando todos los campos.
 *
 * Este format extrae las propiedades del objeto al nivel raíz antes de
 * que cualquier otro transform las procese.
 */
const extraerCamposDeMessage = winston.format((info) => {
  // Si se pasó un objeto plano como primer argumento, extraer sus campos al nivel raíz
  if (info.message !== null && typeof info.message === 'object') {
    const { message: msg, ...campos } = info.message as Record<string, unknown>;
    Object.assign(info, { message: msg ?? '', ...campos });
  }

  // Auto-inyectar severity desde el mapa de CodigosError si no viene explícita
  if (info.code && !info.severity) {
    const sev = SEVERIDAD[info.code as CodigoError];
    // IGNORAR_REMOTO = error de conectividad esperado, se muestra como BAJA en el visor
    info.severity = sev === 'IGNORAR_REMOTO' ? 'BAJA' : (sev ?? undefined);
  }

  return info;
})();

/**
 * Transport personalizado:
 * intercepta errores y los envía automáticamente
 * al ErrorBatchService según severidad.
 */
class ErrorBatchTransport extends Transport {

  constructor() {
    super({
      level: 'error'
    });
  }

  log(info: any, callback: () => void): void {

    // Avisamos inmediatamente a Winston
    callback();

    if (!info?.code || !debeEnviar(info.code)) {
      return;
    }

    setImmediate(() => {
      try {

        // Lazy require para evitar circular dependency
        // logger -> ErrorBatchService -> logger

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ErrorBatchServ } = require('../services/errorBatchService');

        ErrorBatchServ.registrar(
          info.code,
          info.message ?? ''
        );

      } catch {
        // Nunca romper el logger desde acá
      }
    });
  }
}

export const logger = winston.createLogger({

  level:
    process.env.NODE_ENV === 'production'
      ? 'info'
      : 'debug',

  format: winston.format.combine(

    extraerCamposDeMessage,

    winston.format.timestamp({
      format: timezoned
    }),

    winston.format.errors({
      stack: true
    }),

    winston.format.json()
  ),

  transports: [

    // Consola
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({format: timezoned}),
        consoleFormat
      )
    }),

    // Archivo de errores (solo level error)
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/error.log'),
      level: 'error'
    }),

    // Archivo de actividad general (info, warn, error)
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/app.log'),
      level: 'info'
    }),

    //Envío automático a AdminServer
    new ErrorBatchTransport()
  ]
});