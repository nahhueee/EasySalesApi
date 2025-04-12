import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Cargar el archivo .env dependiendo del entorno
const envFilePath = path.resolve(__dirname, `../../.env`);
dotenv.config({ path: envFilePath });

const env = process.env.NODE_ENV || 'pc';  // Si no se define NODE_ENV, por defecto 'pc'

// Cargar el archivo de configuración correspondiente según el entorno
const configFile = `config.${env}.json`;  // El archivo se llama 'config.pc.json' o 'config.web.json'
const rawConfig = fs.readFileSync(path.resolve(__dirname, `../../${configFile}`), 'utf-8');
const config = JSON.parse(rawConfig);

// Verificar que la configuración exista para el entorno
if (!config) {
  throw new Error(`No se encontró archivo de configuracion: ${configFile}`);
}

// Exportar la configuración
export default config;
