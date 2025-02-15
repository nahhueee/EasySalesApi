const path = require('path');
const fs = require('fs');

// Carga el archivo JSON desde la raíz
const configPath = path.resolve(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Elige la configuración correcta (pc o web)
const dbConfig = config.pc.db;

module.exports = {
  development: {
      client: 'mysql2', 
      connection: {
        host: dbConfig.host,
        user: dbConfig.user,
        password: dbConfig.password,
        database: dbConfig.database
      },
      migrations: {
        directory: 'db/tasks',  // Ruta donde se generan y almacenan las migraciones
      },
      seeds: {
        directory: 'db/seeds'  // Ruta para los archivos de seeds
      }
    }
};
  