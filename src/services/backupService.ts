import {ParametrosRepo} from '../data/parametrosRepository';
import {BackupsRepo} from '../data/backupsRepository';
import {AdminServ} from '../services/adminService';
import logger from '../log/logger';
import config from '../conf/app.config';
import { Storage } from 'megajs';
const moment = require('moment');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');

let scheduledTask; // Variable para guardar la tarea programada

class BackupsService{

    async IniciarCron(){
        try{ 
            //Obtenemos los parametros necesarios
            //#region PARAMETROS
            const dniCliente = await ParametrosRepo.ObtenerParametros('dni');
            const expresion = await ParametrosRepo.ObtenerParametros('expresion');
            //#endregion

            if(dniCliente!="")
                EjecutarProcesoCron(dniCliente, expresion);
                  
        } catch(error:any){
            logger.error("Error al intentar iniciar los procesos de respaldo. " + error.message);
        }
    }
}

//Funcion para inicar el cron de respaldo
async function EjecutarProcesoCron(DNI:string, expresion:string){
    if (expresion!="") {

        // Si ya existe una tarea programada, la detenemos para iniciar una nueva y no crear crones en simultaneo
        if (scheduledTask){
            scheduledTask.stop(); 
        } 
        
        //Solo si el parametro de activar esta habilitado, iniciamos el proceso de cron
        const activarBackup = await ParametrosRepo.ObtenerParametros('backups');
        
        if(activarBackup=="true"){
            // Programamos la nueva tarea para crear backups
            scheduledTask = cron.schedule(expresion, async () => {

                //Verificamos que el cliente este habilitado para sincronizar
                const habilitado = await AdminServ.ObtenerHabilitacion(DNI)
            
                if((habilitado)){
                    logger.info('Se inicia un nuevo proceso de respaldo en cron.');

                    //Nombre del archivo
                    const fileName = `${DNI}_${moment().format('DD-MM-YYYY')}.sql`;
                    
                    //Path donde guardamos el backup    
                    const backupPath = path.join(__dirname, "../upload/", fileName);

                    if(await GenerarBackup(backupPath)){
                        
                        const megastorage = await ConectarConMega(); //Logging Mega

                        //Verificamos que el cliente tenga 3 backups en el servidor
                        //Si tiene 3 borramos el mas viejo para crear uno más reciente
                        const backups = await BackupsRepo.ObtenerUltimoRenovar();
                        if(backups.total==3){
                            EliminarDeMega(megastorage,backups.fila.nombre); //Borramos el archivo en Mega
                            BackupsRepo.Eliminar(backups.fila.nombre); //Borramos el registro local
                        }

                        //Subimos el backup a Mega
                        const subido = await SubirAMega(megastorage, fileName);

                        //Guardamos el registro de backup
                        if(subido){
                            await BackupsRepo.Agregar(fileName);
                            fs.unlinkSync(backupPath); // Elimina el archivo localmente
                        }
                    }
                }else{
                    logger.info('Cliente inexistente o inhabilitado');
                }
                
                logger.info('Finalizó el proceso de respaldo.');
            });
        }
    }
}

//#region SUBIDA Y ELIMINACION DE BACKUPS A MEGA
async function ConectarConMega():Promise<Storage> {
    return new Promise((resolve, reject) => {
        const megastorage = new Storage({
            email: config.mega.email,  
            password: config.mega.pass,       
        }, error => {
            if (error) {
                logger.info('Error al intentar conectar a MEGA. ' + error);
                reject(new Error('Error al intentar conectar a MEGA: ' + error));
            } else {
                logger.info('Conectado a MEGA correctamente.');
                resolve(megastorage);
            }
        });
    });
}

// Función para obtener el tamaño del archivo
function getFileSize(filePath) {
    const stats = fs.statSync(filePath);
    return stats.size;
}

// Función para subir el archivo de respaldo a MEGA
async function SubirAMega(megastorage:Storage, fileName:string) {
    try {

        const filePath = path.join(__dirname, "../upload/", fileName);  // Ruta del archivo .sql
        const fileSize = getFileSize(filePath);// Obtener el tamaño del archivo
        
        // Buscar la carpeta destino
        const targetFolder = megastorage.root.children!.find(child => child.name === config.mega.folderName && child.directory);

        if (!targetFolder) {
            logger.info(`Carpeta ${config.mega.folderName} no encontrada en MEGA.`);
            return;
        }

        // Subir el archivo a la carpeta 
        const fileStream = fs.createReadStream(filePath);  // Ruta del archivo
        const uploadStream = targetFolder.upload({ name: fileName, size: fileSize });  // Nombre en MEGA


        const resultado = await new Promise((resolve, reject) => {
            
            // Conectar los streams para subir el archivo
            fileStream.pipe(uploadStream);

            uploadStream.on('complete', (file) => {
                logger.info(`Archivo subido correctamente: ${fileName}`);
                resolve(true);  
            });

            uploadStream.on('error', (error) => {
                logger.info(`Archivo subido correctamente: ${error}`);
                reject(false);  // Rechazar la promesa si hay un error
            });
        });

        return resultado;

    } catch (error) {
        logger.info('Error al intentar subir el archivo a MEGA. ' + error);
        return false;
    }
}

async function EliminarDeMega(megastorage:Storage, fileName:string) {
    try {

        //Obtenemos la carpeta de backups
        const folder = megastorage.root.children!.find(child => child.name === config.mega.folderName && child.directory);
        if (folder) {
            // Buscar el archivo dentro de la carpeta
            const file = folder.children!.find(child => child.name === fileName);

            if (file) {
                // Eliminar el archivo encontrado
                file.delete(true, (error) => {
                    if (error)
                        logger.info(`Error al eliminar el archivo ${fileName}: ` + error);
                    else 
                        logger.info(`Archivo ${fileName} eliminado correctamente de Mega.`);
                });
            } else {
                logger.info(`Archivo ${fileName} no encontrado en Mega para borrar.`);
            }
        }else
            logger.info(`No se encontró la carpeta al intentar borrar un archivo de Mega.`);
       
    } catch (error) {
        logger.info('Error al intentar eliminar el archivo a MEGA. ' + error);
    }
}
//#endregion


//#region SUBIDA DE ARCHIVOS Y ELIMINACION EN DRIVE --- DEPRECADO

// Obtiene la autenticacion de google drive utilizando credenciales de servicio
// async function authenticate() {
//     const auth = await new google.auth.GoogleAuth({
//       keyFile: path.join(__dirname, "../conf/adminservice-435500-8d0b1bdcf189.json"), // Ruta del archivo de credenciales de servicio
//       scopes: ['https://www.googleapis.com/auth/drive.file'],
//     });
//     return auth;
// }

//Sube el archivo de backup a drive
// async function SubirArchivoDrive(filename, auth) {
//     const drive = google.drive({ version: 'v3', auth });
//     const filePath = path.join(__dirname, "../upload/", filename);  // Ruta del archivo .sql

//     const fileMetadata = {
//       name: filename,  // Nombre que tendrá el archivo en Drive
//       parents: ['1dbzEQwhvMNOz1VRcYUGx8hCfxEPYb2jZ'], //Id de la carpeta donde se ubicará
//       role: 'reader',
//       type: 'user',
//       emailAddress: 'creationcode.mc@gmail.com'
//     };

//     // Verifica que el archivo tiene contenido
//     const stats = fs.statSync(filePath);
//     if (stats.size === 0) {
//         logger.info('El archivo esta vacio.');
//         return;
//     }

//     const media = {
//         mimeType: 'application/sql',
//         body: await fs.createReadStream(filePath),
//     };

//     try {
//         const file = await drive.files.create({
//             resource: fileMetadata,
//             media: media,
//             fields: 'id',
//         });
  
//         logger.info(`Archivo subido correctamente: ${file.data.id}`);
//         return file.data.id;
//     } catch (error) {
//         logger.info('Error al intentar subir el archivo a drive. ' + error);
//         return null;
//     }
// }

//Elimina por id un archivo en google drive
// async function EliminarArchivoDrive(fileId, auth) {
//     const drive = google.drive({ version: 'v3', auth });
  
//     try {
//         await drive.files.delete({ fileId });
//         logger.info(`Archivo con ID ${fileId} ha sido eliminado.`);
//     } catch (error) {
//         logger.info('Error al intentar eliminar el archivo de drive. ' + error);
//     }
// }
//#endregion 


//#region CREAR ARCHIVO BACKUP
async function GenerarBackup(backupPath:string){
    
    //comando a ejecutar
    let command = "";
    if(config.produccion)
        command = `mysqldump -u ${config.db.user} -p ${config.db.password} ${config.db.database} > ${backupPath}`;
    else
        command = `mysqldump -u ${config.db.user} ${config.db.database} > ${backupPath}`;
   
    //Ejecutamos el comando
    const { stdout, stderr } = await exec(command);
    if (stderr) {
        logger.info(`Error al ejecutar el comando: ${stderr.message}`);
        return null;
    }
    
    logger.info('Se generó correctamente el archivo de backup.');
    return true;
}
//#endregion 

  
export const BackupsServ = new BackupsService();