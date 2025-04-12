const path = require('path');
const fs = require('fs');
const env = process.env.NODE_ENV || 'pc';  // Si no se define NODE_ENV, por defecto 'pc'

// Carga el archivo JSON desde la raíz
const configFile = `config.${env}.json`; 
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

module.exports = {
  development: {
      client: 'mysql2', 
      connection: {
        host: config.host,
        user: config.user,
        password: config.password,
        database: config.database
      },
      migrations: {
        directory: './src/db/tasks',  // Ruta donde se generan y almacenan las migraciones
      },
      seeds: {
        directory: './src/db/seeds'  // Ruta para los archivos de seeds
      }
    }
};
  