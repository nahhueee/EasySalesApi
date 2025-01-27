import config from '../conf/app.config';
import logger from '../log/logger';
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const axios = require('axios');
import { io } from '../index'; 

import knex from 'knex';
import knexConfig from '../../knexfile.js';
import { BackupsServ } from './backupService';

const knexcommand = knex(knexConfig.development);

class ActualizacionService{

    async Actualizar(url:string) {
        const updateFolder = path.join(__dirname, '../../update/'); //Carpeta de actualización
        const zipFilePath = path.join(updateFolder, 'comprimido.rar'); //Zip descargado
        const pathDestino = path.join(__dirname, '../../../'); //Carpeta donde se encuentra la app

        try {
          io.emit('progreso', 'Descargando actualización');
          await DescargarArchivo(url,zipFilePath); //Descargamos los archivos nuevos
      
          io.emit('progreso', 'Descomprimiendo');
          await DescomprimirEnCarpeta(zipFilePath, updateFolder); //Descomprimimos en una temporal

          io.emit('progreso', 'Copiando archivos nuevos');

          //Verificamos que la carpeta frontend tenga archivos para actualizar
          const pathFront = path.join(updateFolder, 'frontend');
          if (fs.existsSync(pathFront) && TieneArchivos(pathFront)) 
            ReemplazarArchivos(pathFront,  path.join(pathDestino, 'easysalesapp'));

          //Verificamos que la carpeta backend tenga archivos para actualizar
          const pathBack = path.join(updateFolder, 'backend');
          if (fs.existsSync(pathBack) && TieneArchivos(pathBack)) 
            ReemplazarArchivos(pathBack,  path.join(pathDestino, 'easysalesserver'));

          //Creamos una copia de seguridad antes de ejecutar migraciones
          io.emit('progreso', 'Creando una copia de seguridad');
          const backupPath = path.join(__dirname, "../upload/", "updateBackup.sql");
          await BackupsServ.GenerarBackup(backupPath); //Copia de seguridad actual de la base de datos

          //Corremos las migraciones
          io.emit('progreso', 'Actualizando la base de datos');
          await knexcommand.migrate.latest(); // Ejecuta las migraciones

          io.emit('progreso', 'Actualización completa');

          //Reiniciamos el servidor
          if(config.produccion)
            await ReiniciarServidor();

        } catch (error:any) {
          io.emit('error', 'Ocurrió un error al intentar actualizar');
          logger.error("Error en el proceso de actualización: " + error.message);
        }
    }

}

async function DescargarArchivo(url:string, zipFilePath:string) {

    const writer = fs.createWriteStream(zipFilePath); //Lugar donde se escribe el comprimido
  
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
    });

    response.data.pipe(writer);
  
    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
}

async function DescomprimirEnCarpeta(zipPath, updateFolder) {
  try {
    // Leer el archivo zip
    const data = await fs.promises.readFile(zipPath);

    // Cargar el archivo zip usando JSZip
    const zip = await JSZip.loadAsync(data);

    // Recorrer todos los archivos dentro del .zip
    for (const relativePath of Object.keys(zip.files)) {
      const file = zip.files[relativePath];
      const fullPath = path.join(updateFolder, relativePath);

      if (file.dir) {
        // Si es un directorio, crear si no existe
        fs.mkdirSync(fullPath, { recursive: true });
      } else {
        // Si es un archivo, escribirlo en la ruta correspondiente
        ExisteDirectorio(fullPath);
        const contenido = await file.async("nodebuffer");
        await fs.promises.writeFile(fullPath, contenido);
      }
    }
  } catch (error) {
    throw error;
  }
}

function ReemplazarArchivos(origen:string, destino:string) {
  try{
    const archivos = fs.readdirSync(origen);

    archivos.forEach((archivo) => {
      const rutaArchivoOrigen = path.join(origen, archivo);
      const rutaArchivoDestino = path.join(destino, archivo);
  
      // Verificar si es un directorio o un archivo
      if (fs.lstatSync(rutaArchivoOrigen).isDirectory()) {
        // Crear la carpeta si no existe
        if (!fs.existsSync(rutaArchivoDestino)) {
          fs.mkdirSync(rutaArchivoDestino, { recursive: true });
        }
      } 
      //Copiamos lo descargado en la ruta de la app
      fs.copyFileSync(rutaArchivoOrigen, rutaArchivoDestino);
  
      //Borramos los archivos de actualizacion
      fs.unlinkSync(rutaArchivoOrigen);
    });
  }catch (error) {
    throw error;
  }
}

// Función para crear directorios si no existen
function ExisteDirectorio(rutaArchivo) {
  const directorio = path.dirname(rutaArchivo);
  if (!fs.existsSync(directorio)) {
    fs.mkdirSync(directorio, { recursive: true });
  }
}

// Función para verificar si la carpeta tiene archivos
function TieneArchivos(rutaCarpeta) {
  return fs.readdirSync(rutaCarpeta).length > 0;
}


async function ReiniciarServidor(){
    
  //comando a ejecutar
  let command = "pm2 restart all";
 
  //Ejecutamos el comando
  const { stdout, stderr } = await exec(command);
  if (stderr) {
      logger.error(`Error al ejecutar el comando: ${stderr.message}`);
      return null;
  }
  
  return true;
}

export const ActualizacionServ = new ActualizacionService();