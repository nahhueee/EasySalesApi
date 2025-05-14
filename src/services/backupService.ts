import {ParametrosRepo} from '../data/parametrosRepository';
import {BackupsRepo} from '../data/backupsRepository';
import {AdminServ} from '../services/adminService';
import backupLogger from '../log/loggerBackups';
import config from '../conf/app.config';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';
const moment = require('moment');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');


const { exec } = require('child_process');
const { promisify } = require('util');

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
                this.EjecutarProcesoCron(dniCliente, expresion);
                  
        } catch(error:any){
            backupLogger.error("Error al intentar iniciar los procesos de respaldo. " + error.message);
        }
    }

    async GenerarBackupLocal(){
        try {
            const carpeta = path.join('C:', 'backups');

            if (!fs.existsSync(carpeta)) {
                fs.mkdirSync(carpeta, { recursive: true });
            } 

            const fecha = new Date().toISOString().slice(0, 10); 
            const archivo = path.join(carpeta, `respaldo_${fecha}.sql`);
            await GenerarBackup(archivo);

            return "OK";

        } catch (error) {
            throw error;
        }
       
    }

    //Funcion para inicar el cron de respaldo
    async EjecutarProcesoCron(DNI:string, expresion:string){
        try{

            if (expresion!="") {

                // Si ya existe una tarea programada, la detenemos para iniciar una nueva y no crear crones en simultaneo
                if (scheduledTask) {
                    scheduledTask.stop();
                    scheduledTask = null;
                }
                
                //Solo si el parametro de activar esta habilitado, iniciamos el proceso de cron
                const activarBackup = await ParametrosRepo.ObtenerParametros('backups');
                if (activarBackup !== "true") {
                    return;
                }

                //Verificamos que el cliente este habilitado para sincronizar
                const habilitado = await AdminServ.ObtenerHabilitacion(DNI)
                if (!habilitado) {
                    backupLogger.info('Cliente inexistente o inhabilitado para generar backups.');
                    return;
                }

                // Programamos la nueva tarea para crear backups
                scheduledTask = cron.schedule(expresion, async () => {
                    backupLogger.info('Se inicia un nuevo proceso de respaldo en cron.');

                    //Nombre del archivo
                    const fileName = `${DNI}_${moment().format('DD-MM-YYYY')}.sql`;

                    //Path donde guardamos el backup    
                    const backupPath = path.join(__dirname, "../upload/", fileName);
                    await eliminarArchivo(backupPath); // Elimina el archivo

                    //Generamos el backup
                    await GenerarBackup(backupPath)
                    if(!existsSync(backupPath)){
                        backupLogger.error('Parece que ocurrio un error al intentar generar un backup.');
                        return;
                    }

                    //El servidor se encarga de verificar si el usuario tiene mas de 3 backups subidos
                    //Se borra el más antiguo, y se sube el nuevo
                    const resultado = await AdminServ.SubirBackup(backupPath, DNI);
                    if(resultado=="OK"){
                        backupLogger.info('Se subió correctamente el archivo al servidor.');

                        //Agregamos el registro a la base local
                        await BackupsRepo.Agregar(fileName);
                        fs.unlinkSync(backupPath); // Elimina el archivo localmente
                    }
                    else
                        backupLogger.error('Ocurrió un error al intentar subir el archivo al servidor. ' + resultado);

                    
                    backupLogger.info('Finalizó correctamente el proceso de respaldo.');
                });

            }
        }
        catch (error: any) {
            backupLogger.error("Error dentro del proceso cron: " + error.message);
            console.error(error);
        }
    }
}

//#region SUBIDA Y ELIMINACION DE BACKUPS A MEGA ---- DEPRECADO
// async function ConectarConMega():Promise<Storage> {
//     console.log(config.mega.email, config.mega.pass)
//     return new Promise((resolve, reject) => {
//         const megastorage = new Storage({
//             email: config.mega.email,  
//             password: config.mega.pass,       
//         }, error => {
//             if (error) {
//                 backupLogger.error('Error al intentar conectar a MEGA. ' + error);
//                 reject(new Error('Error al intentar conectar a MEGA: ' + error));
//             } else {
//                 backupLogger.info('Conectado a MEGA correctamente.');
//                 resolve(megastorage);
//             }
//         });
//     });
// }



// // Función para obtener el tamaño del archivo
// function getFileSize(filePath) {
//     const stats = fs.statSync(filePath);
//     return stats.size;
// }

// // Función para subir el archivo de respaldo a MEGA
// async function SubirAMega(megastorage:Storage, fileName:string) {
//     try {

//         const filePath = path.join(__dirname, "../upload/", fileName);  // Ruta del archivo .sql
//         const fileSize = getFileSize(filePath);// Obtener el tamaño del archivo
        
//         // Buscar la carpeta destino
//         const targetFolder = megastorage.root.children!.find(child => child.name === config.mega.folderName && child.directory);

//         if (!targetFolder) {
//             backupLogger.error(`Carpeta ${config.mega.folderName} no encontrada en MEGA.`);
//             return;
//         }

//         // Subir el archivo a la carpeta 
//         const fileStream = fs.createReadStream(filePath);  // Ruta del archivo
//         const uploadStream = targetFolder.upload({ name: fileName, size: fileSize });  // Nombre en MEGA


//         const resultado = await new Promise((resolve, reject) => {
            
//             // Conectar los streams para subir el archivo
//             fileStream.pipe(uploadStream);

//             uploadStream.on('complete', (file) => {
//                 backupLogger.info(`Archivo subido correctamente a MEGA: ${fileName}`);
//                 resolve(true);  
//             });

//             uploadStream.on('error', (error) => {
//                 backupLogger.info(`Error al subir el archivo a MEGA: ${error}`);
//                 reject(false);  // Rechazar la promesa si hay un error
//             });
//         });

//         return resultado;

//     } catch (error) {
//         backupLogger.error('Error al intentar subir el archivo a MEGA. ' + error);
//         return false;
//     }
// }

// async function EliminarDeMega(megastorage:Storage, fileName:string) {
//     try {

//         //Obtenemos la carpeta de backups
//         const folder = megastorage.root.children!.find(child => child.name === config.mega.folderName && child.directory);
//         if (folder) {
//             // Buscar el archivo dentro de la carpeta
//             const file = folder.children!.find(child => child.name === fileName);

//             if (file) {
//                 // Eliminar el archivo encontrado
//                 file.delete(true, (error) => {
//                     if (error)
//                         backupLogger.error(`Error al eliminar el archivo ${fileName}: ` + error);
//                     else 
//                     backupLogger.info(`Archivo ${fileName} eliminado correctamente de Mega.`);
//                 });
//             } else {
//                 backupLogger.error(`Archivo ${fileName} no encontrado en Mega para borrar.`);
//             }
//         }else
//             backupLogger.error(`No se encontró la carpeta al intentar borrar un archivo de Mega.`);
       
//     } catch (error) {
//         backupLogger.error('Error al intentar eliminar el archivo a MEGA. ' + error);
//     }
// }
//#endregion


async function eliminarArchivo(filePath: string) {
    if (existsSync(filePath)) { // Verifica si el archivo existe
        try {
            await unlink(filePath); // Elimina el archivo
        } catch (error) {
            backupLogger.error(`Error al intentar eliminar el archivo: ${error}`);
        }
    } 
}

async function GenerarBackup(backupPath: string) {
    return new Promise<boolean>((resolve, reject) => {
        const args = [`-u`, config.db.user];

        if (config.produccion) {
            args.push(`-p${config.db.password}`);
        }

        args.push(config.db.database);

        const dumpProcess = spawn('mysqldump', args);
        const output = createWriteStream(backupPath);

        dumpProcess.stdout.pipe(output);

        dumpProcess.stderr.on('data', (data) => {
            backupLogger.error(`Error en mysqldump: ${data}`);
        });

        dumpProcess.on('close', (code) => {
            if (code === 0) {
                backupLogger.info(`Backup generado correctamente`);
                resolve(true);
            } else {
                backupLogger.error(`mysqldump finalizó con código: ${code}`);
                reject(false);
            }
        });

        dumpProcess.on('error', (err) => {
            backupLogger.error(`Error al lanzar mysqldump: ${err}`);
            reject(false);
        });
    });
}

export const BackupsServ = new BackupsService();