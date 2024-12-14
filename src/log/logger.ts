import winston from 'winston';
import * as path from 'path';
const moment = require('moment-timezone');

const timezoned = () => {
  return moment().tz('America/Argentina/Buenos_Aires').format('YYYY-MM-DD HH:mm');
};

const logger = winston.createLogger({
  transports: [

    // Transporte para errores
    new winston.transports.File({ 
      filename: path.resolve(__dirname, 'error.log'),
      level: 'error', // Solo registrar mensajes con nivel 'error'
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        winston.format.errors({ stack: true }),
        winston.format.printf(info => `${info.timestamp} - ${info.message}\n${info.stack || ''}`),
        winston.format.json(),
      )
    }),

    // Transporte para mensajes del backp
    new winston.transports.File({ 
      filename: path.resolve(__dirname, 'backups.log'),
      level: 'info', // Registrar mensajes con nivel 'info' y superior
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        winston.format.errors({ stack: true }),
        winston.format.printf(info => `${info.timestamp} - ${info.message}\n${info.stack || ''}`),
        winston.format.json(),
      )
    }),

    // Transporte para consola
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }), // Agregar timestamp
        winston.format.errors({ stack: true }), // Mostrar el stack de errores
        // winston.format.printf(info => `${info.timestamp} - ${info.stack}: ${info.message}`) // Formato del mensaje de registro
      )
    })
  ],
  
});

export default logger; 
