import winston from 'winston';
import path from 'path';

const timezoned = () =>
  new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

const consoleFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level}] ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',

  format: winston.format.combine(
    winston.format.timestamp({ format: timezoned }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),

  transports: [

    // consola (solo mensaje)
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        consoleFormat
      )
    }),

    // archivo (json completo)
    new winston.transports.File({
      filename: path.resolve(__dirname, '../log/error.log'),
      level: 'error'
    }),
  ]
});
