import winston from 'winston';
import * as path from 'path';
const moment = require('moment-timezone');

const timezoned = () => {
  return moment().tz('America/Argentina/Buenos_Aires').format('YYYY-MM-DD HH:mm');
};

// Configurar el nivel de registro y el formato
const logger = winston.createLogger({
  level: 'error',
  transports: [
    new winston.transports.Console(), // Salida por consola
    new winston.transports.File({ 
      filename: path.resolve(__dirname, 'error.log'), // Salida a archivo
      format: winston.format.json() // Formato JSON para el archivo de registro
    }) 
  ],
  format: winston.format.combine(
    winston.format.timestamp({ format: timezoned }), // Agregar timestamp
    winston.format.errors({ stack: true }), // Mostrar el stack de errores
    winston.format.printf(info => `${info.timestamp} - ${info.stack}: ${info.message}`) // Formato del mensaje de registro
  )
});

export default logger; 
