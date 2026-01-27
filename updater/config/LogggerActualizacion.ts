import winston from 'winston';
import * as path from 'path';

const ROOT_DIR = path.resolve(__dirname, '../../');
const LOG_FILE = path.join(ROOT_DIR, 'updater/actualizaciones.log');

const logFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const fase = meta.fase ? ` | fase=${meta.fase}` : '';
  const modulo = meta.modulo ? ` | modulo=${meta.modulo}` : '';
  return `${timestamp} [${level.toUpperCase()}]${fase}${modulo} | ${message}`;
});

export const LoggerActualizacion = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'DD-MM-YY HH:mm:ss' }),
    logFormat
  ),
  transports: [
    new winston.transports.File({
      filename: LOG_FILE,
      handleExceptions: true,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 3
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      )
    })
  ],
  exitOnError: false
});
