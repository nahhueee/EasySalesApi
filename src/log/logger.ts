import winston from 'winston';

// Configurar el nivel de registro y el formato
const logger = winston.createLogger({
  level: 'error',
  transports: [
    new winston.transports.Console(), // Salida por consola
    new winston.transports.File({ 
      filename: 'error.log', // Salida a archivo
      format: winston.format.json() // Formato JSON para el archivo de registro
    }) 
  ],
  format: winston.format.combine(
    winston.format.timestamp(), // Agregar timestamp
    winston.format.errors({ stack: true }), // Mostrar el stack de errores
    winston.format.printf(info => `${info.timestamp} - ${info.stack}: ${info.message}`) // Formato del mensaje de registro
  )
});

export default logger; 
