import winston from 'winston';
import * as path from 'path';
const fs = require('fs');
const moment = require('moment-timezone');

const timezoned = () => {
  return moment().tz('America/Argentina/Buenos_Aires').format('DD-MM-YY HH:mm');
};


const logFilePath = path.resolve(__dirname, 'backup.json');

// Asegurar que el archivo existe y contiene un array JSON válido
if (!fs.existsSync(logFilePath)) {
  fs.writeFileSync(logFilePath, '[]'); // Iniciar con un array vacío
}

const agregarAlLog = (info) => {
  try {
    const logs = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));
    logs.push(info);
    fs.writeFileSync(logFilePath, JSON.stringify(logs, null, 2)); // Guardar como array JSON
  } catch (error) {
    console.error('Error al escribir el log:', error);
  }
};


export const limpiarLog = () => {
  fs.writeFileSync(logFilePath, '[]'); // Reiniciar como array vacío
};

const backupsLogs = winston.createLogger({
  transports: [

    // Transporte para errores, warns e info
    new winston.transports.File({ 
      filename: path.resolve(logFilePath),
      format: winston.format.combine(
        winston.format.timestamp({ format: timezoned }),
        winston.format.errors({ stack: true }),
        winston.format.json(),
        winston.format.printf(registro => {
          agregarAlLog(registro);
          return ''; // Evita escribir en formato incorrecto
        })
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

export default backupsLogs; 
