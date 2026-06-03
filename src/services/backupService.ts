/**
 * SERVICIO DE BACKUPS
 * ===================
 * Genera backups de la base de datos y los sube a AdminServer.
 *
 * Política de backups:
 * - AdminServer conserva los últimos 3 backups por cliente
 * - El cron se configura desde parámetros de la DB (expresión cron + flag activar)
 * - Los archivos se generan localmente en src/upload/ y se eliminan tras la subida
 *
 * El cron NO depende de verificar habilitación en el arranque.
 * La verificación de terminal habilitada ocurre dentro de cada ejecución.
 */

import { ParametrosRepo } from '../data/parametrosRepository';
import { BackupsRepo } from '../data/backupsRepository';
import { AdminServ } from '../services/adminService';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';
import config from '../conf/app.config';
import { unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { createWriteStream } from 'fs';

const moment  = require('moment');
const cron    = require('node-cron');
const path    = require('path');
const fs      = require('fs');

// Estado del último intento de backup — leído por heartbeatService
export const BACKUP_ESTADO_PATH = path.join(process.cwd(), 'src', 'log', 'backup-estado.json');

async function EscribirEstadoBackup(ok: boolean): Promise<void> {
    try {
        await writeFile(BACKUP_ESTADO_PATH, JSON.stringify({
            fecha: moment().format('YYYY-MM-DD HH:mm:ss'),
            ok,
        }));
    } catch {
        // No crítico: si no se puede escribir el estado, el heartbeat enviará null
    }
}

let scheduledTask: any = null;

class BackupsService {

    async IniciarCron(): Promise<void> {
        try {
            const expresion = await ParametrosRepo.ObtenerParametros('expresion');

            if (!expresion || expresion === '') {
                logger.info({ type: 'BACKUP_INFO', message: 'Sin expresión cron configurada. Backups no iniciados.', modulo: 'backupService' });
                return;
            }

            this.EjecutarProcesoCron(expresion);

        } catch (error: any) {
            // No crítico: si no se puede leer la configuración, se loguea y se continúa.
            // El cron puede reintentarse en el próximo arranque.
            logger.error({
                code:    CodigoError.CRON_INIT_ERROR,
                message: error.message || 'Error al iniciar cron de backups',
                modulo:  'backupService',
                cause:   error.cause?.message,
                stack:   error.stack,
            });
        }
    }

    async GenerarBackupLocal(): Promise<string> {
        const carpeta = path.join(process.cwd(), 'src', 'upload', 'backups-locales');

        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }

        const fecha   = new Date().toISOString().slice(0, 10);
        const archivo = path.join(carpeta, `respaldo_${fecha}.sql`);

        await GenerarBackup(archivo);
        return 'OK';
    }

    private EjecutarProcesoCron(expresion: string): void {
        // Detiene la tarea anterior si existía (evita crones en simultáneo)
        if (scheduledTask) {
            scheduledTask.stop();
            scheduledTask = null;
        }

        scheduledTask = cron.schedule(expresion, async () => {
            try {
                // Verificamos configuración en cada ejecución (no en el arranque)
                const activarBackup = await ParametrosRepo.ObtenerParametros('backups');
                if (activarBackup !== 'true') return;

                const dniCliente = await ParametrosRepo.ObtenerParametros('dni');
                if (!dniCliente || dniCliente === '') {
                    logger.warn({ type: 'BACKUP_WARN', message: 'DNI de cliente no configurado. Backup omitido.', modulo: 'backupService' });
                    return;
                }

                logger.info({ type: 'BACKUP_INFO', message: 'Iniciando proceso de respaldo.', modulo: 'backupService' });

                const fileName   = `${dniCliente}_${moment().format('DD-MM-YYYY')}.sql`;
                const backupPath = path.join(__dirname, '../upload/', fileName);

                // Elimina versión anterior del mismo día si existe
                await eliminarArchivo(backupPath);

                await GenerarBackup(backupPath);

                if (!existsSync(backupPath)) {
                    logger.error({ code: CodigoError.BACKUP_GENERACION_ERROR, message: 'El archivo de backup no se generó.', modulo: 'backupService' });
                    return;
                }

                const resultado = await AdminServ.SubirBackup(backupPath, dniCliente);

                if (resultado === 'OK') {
                    await BackupsRepo.Agregar(fileName);
                    await eliminarArchivo(backupPath);
                    await EscribirEstadoBackup(true);
                    logger.info({ type: 'BACKUP_INFO', message: `Backup subido correctamente: ${fileName}`, modulo: 'backupService' });
                } else {
                    await EscribirEstadoBackup(false);
                    logger.error({ code: CodigoError.BACKUP_UPLOAD_ERROR, message: `Error al subir backup: ${resultado}`, modulo: 'backupService' });
                }

            } catch (error: any) {
                await EscribirEstadoBackup(false);
                logger.error({
                    code:    CodigoError.BACKUP_GENERACION_ERROR,
                    message: error.message || 'Error al generar backup',
                    modulo:  'backupService',
                    cause:   error.cause?.message,
                    stack:   error.stack,
                });
            }
        });

        logger.info({ type: 'BACKUP_INFO', message: `Cron de backups iniciado (${expresion}).`, modulo: 'backupService' });
    }
}

async function eliminarArchivo(filePath: string): Promise<void> {
    if (existsSync(filePath)) {
        await unlink(filePath);
    }
}

async function GenerarBackup(backupPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const args = ['-u', config.db.user];
        args.push(`-p${config.db.password}`);
        args.push(config.db.database);

        const dumpProcess = spawn('mysqldump', args);
        const output      = createWriteStream(backupPath);

        dumpProcess.stdout.pipe(output);

        // Acumulamos stderr para incluirlo en el error si el proceso falla.
        // mysqldump también escribe warnings no críticos en stderr (ej. deprecation),
        // por eso no rechazamos en este evento sino en 'close'.
        const stderrChunks: string[] = [];
        dumpProcess.stderr.on('data', (data: Buffer) => {
            stderrChunks.push(data.toString().trim());
        });

        dumpProcess.on('close', (code: number) => {
            const stderrOutput = stderrChunks.join(' | ');

            if (code === 0) {
                // Warnings presentes pero proceso exitoso — loguear sin bloquear
                if (stderrOutput) {
                    logger.warn({ type: 'BACKUP_WARN', message: `mysqldump warnings: ${stderrOutput}`, modulo: 'backupService' });
                }
                resolve();
            } else {
                // El mensaje de causa real está en stderr, no en el código de salida
                const causa = stderrOutput || `código de salida ${code}`;
                reject(new Error(`mysqldump falló: ${causa}`));
            }
        });

        dumpProcess.on('error', (err: Error) => {
            reject(new Error(`No se pudo ejecutar mysqldump: ${err.message}`));
        });
    });
}

export const BackupsServ = new BackupsService();
