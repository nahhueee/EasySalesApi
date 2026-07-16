import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Cargar el archivo .env dependiendo del entorno
const envFilePath = path.resolve(__dirname, `../../.env`);
dotenv.config({ path: envFilePath });

const env = process.env.NODE_ENV || 'pc';  // Si no se define NODE_ENV, por defecto 'pc'

// Cargar el archivo de configuración correspondiente según el entorno
const configFile = `config.${env}.json`;  // El archivo se llama 'config.pc.json' o 'config.web.json'
// Ruta absoluta al archivo de config, resuelta relativa a este módulo (no a dónde esté
// instalado el frontend). Se expone para que quien necesite persistir cambios en runtime
// (ver servidorService.CambiarModoServidor) escriba siempre al mismo archivo que se leyó acá,
// sin duplicar esta resolución de ruta en otro lado.
export const configFilePath = path.resolve(__dirname, `../../${configFile}`);
const rawConfig = fs.readFileSync(configFilePath, 'utf-8');
const config = JSON.parse(rawConfig);

// Verificar que la configuración exista para el entorno
if (!config) {
  throw new Error(`No se encontró archivo de configuracion: ${configFile}`);
}

// Exportar la configuración
export default config;
