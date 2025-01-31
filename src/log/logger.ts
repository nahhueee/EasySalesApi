import winston from 'winston';
import * as path from 'path';
const fs = require('fs');
const moment = require('moment-timezone');

const timezoned = () => {
  return moment().tz('America/Argentina/Buenos_Aires').format('YYYY-MM-DD HH:mm');
};

// Ruta para los logs
const logDir = 'C:\\logs\\easysales';

// Crear la carpeta si no existe
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  transports: [

    // Transporte para errores
    new winston.transports.File({ 
      filename: path.resolve(logDir, 'error.log'),
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
      filename: path.resolve(logDir, 'backups.log'),
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
      )
    })
  ],
  
});

export default logger; 
