/**
 * SERVICIO DE BACKUPS
 * ===================
 * Genera backups de la base de datos y los sube a AdminServer.
 *
 * Política de backups:
 * - AdminServer conserva los últimos 3 backups por cliente
 * - El cron se configura desde parámetros de la DB (expresión cron + flag activar)
 * - El staging del dump vive en src/upload/ y se elimina tras la subida
 * - El trigger manual (botón del frontend) además deja una copia permanente
 *   en CARPETA_BACKUPS_CLIENTE (C:\backups) para que el dueño del comercio
 *   la tenga a mano. Sin rotación: son pocos backups manuales por cliente.
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

// Carpeta donde se deja una copia del backup manual para que el dueño del
// comercio la tenga a mano (ver respaldos.component.ts en el frontend).
const CARPETA_BACKUPS_CLIENTE = 'C:\\backups';

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

    /**
     * Trigger manual (botón "Generar backup" del frontend). A diferencia del
     * cron, además de subir a AdminServer deja una copia en
     * CARPETA_BACKUPS_CLIENTE para que el dueño del comercio la tenga a mano.
     */
    async GenerarBackupLocal(): Promise<string> {
        try {
            return await this.EjecutarBackup(true);
        } catch (error: any) {
            await EscribirEstadoBackup(false);
            logger.error({
                code:    CodigoError.BACKUP_GENERACION_ERROR,
                message: error.message || 'Error al generar backup',
                modulo:  'backupService',
                cause:   error.cause?.message,
                stack:   error.stack,
            });
            throw error; // backupRoute.ts lo traduce a AppError 500
        }
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

                await this.EjecutarBackup(false);

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

    /**
     * Ciclo completo de respaldo: lee el DNI configurado, genera el dump,
     * lo sube a AdminServer y lo registra localmente.
     *
     * @param mantenerCopiaCliente Si es true, conserva una copia del .sql en
     *        CARPETA_BACKUPS_CLIENTE incluso si falla la subida a AdminServer
     *        — al dueño del comercio le importa tener el archivo, no el
     *        estado de AdminServer. Usado por el trigger manual.
     */
    private async EjecutarBackup(mantenerCopiaCliente: boolean): Promise<string> {
        const dniCliente = await ParametrosRepo.ObtenerParametros('dni');
        if (!dniCliente || dniCliente === '') {
            logger.warn({ type: 'BACKUP_WARN', message: 'DNI de cliente no configurado. Backup omitido.', modulo: 'backupService' });
            return 'DNI_NO_CONFIGURADO';
        }

        logger.info({ type: 'BACKUP_INFO', message: 'Iniciando proceso de respaldo.', modulo: 'backupService' });

        const fileName   = `${dniCliente}_${moment().format('DD-MM-YYYY')}.sql`;
        const backupPath = path.join(__dirname, '../upload/', fileName);

        // Elimina versión anterior del mismo día si existe
        await eliminarArchivo(backupPath);

        await GenerarBackup(backupPath);

        if (!existsSync(backupPath)) {
            logger.error({ code: CodigoError.BACKUP_GENERACION_ERROR, message: 'El archivo de backup no se generó.', modulo: 'backupService' });
            return 'ERROR_GENERACION';
        }

        if (mantenerCopiaCliente) {
            copiarParaCliente(backupPath, fileName);
        }

        let resultado: string | null;
        try {
            resultado = await AdminServ.SubirBackup(backupPath, dniCliente);
        } catch (error: any) {
            // Distinguimos de un fallo de generación: el archivo local existe,
            // lo que falló es la subida a AdminServer (red, servidor caído, etc.).
            await EscribirEstadoBackup(false);
            logger.error({
                code:      CodigoError.BACKUP_UPLOAD_ERROR,
                message:   error.message || 'Error al subir backup a AdminServer',
                modulo:    'backupService',
                status:    error.response?.status,
                respuesta: extraerMensajeError(error.response?.data),
                stack:     error.stack,
            });
            // Si ya quedó copia para el cliente, el backup manual se considera OK
            // de cara al frontend aunque la subida remota haya fallado.
            return mantenerCopiaCliente ? 'OK' : 'ERROR_UPLOAD';
        }

        if (resultado === 'OK') {
            await BackupsRepo.Agregar(fileName);
            await eliminarArchivo(backupPath);
            await EscribirEstadoBackup(true);
            logger.info({ type: 'BACKUP_INFO', message: `Backup subido correctamente: ${fileName}`, modulo: 'backupService' });
            return 'OK';
        } else {
            await EscribirEstadoBackup(false);
            logger.error({ code: CodigoError.BACKUP_UPLOAD_ERROR, message: `Error al subir backup: ${resultado}`, modulo: 'backupService' });
            return mantenerCopiaCliente ? 'OK' : 'ERROR_UPLOAD';
        }
    }
}

async function eliminarArchivo(filePath: string): Promise<void> {
    if (existsSync(filePath)) {
        await unlink(filePath);
    }
}

/**
 * Copia el backup a CARPETA_BACKUPS_CLIENTE para que el dueño del comercio
 * lo tenga accesible. No crítico: si falla (permisos, disco, etc.) solo se
 * loguea como warning — no debe interrumpir la subida a AdminServer.
 */
function copiarParaCliente(backupPath: string, fileName: string): void {
    try {
        if (!fs.existsSync(CARPETA_BACKUPS_CLIENTE)) {
            fs.mkdirSync(CARPETA_BACKUPS_CLIENTE, { recursive: true });
        }
        fs.copyFileSync(backupPath, path.join(CARPETA_BACKUPS_CLIENTE, fileName));
    } catch (error: any) {
        logger.warn({ type: 'BACKUP_WARN', message: `No se pudo copiar el backup a ${CARPETA_BACKUPS_CLIENTE}: ${error.message}`, modulo: 'backupService' });
    }
}

/**
 * Extrae el mensaje legible de un cuerpo de error HTML (página de error
 * default de Express en modo dev, con el stack dentro de <pre>). Evita
 * loguear el documento HTML completo en el campo `respuesta`.
 */
function extraerMensajeError(data: any): any {
    if (typeof data !== 'string') return data;
    const match = data.match(/<pre>([\s\S]*?)<\/pre>/i);
    return match ? match[1].trim() : data.replace(/<[^>]+>/g, ' ').trim();
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
