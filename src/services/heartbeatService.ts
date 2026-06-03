/**
 * SERVICIO DE HEARTBEAT
 * =====================
 * Envía un pulso periódico a AdminServer con el estado de esta instalación.
 *
 * Corre en toda instancia de EasySalesApi que tenga terminal.json presente.
 * Cada máquina (servidor LAN o standalone) reporta su propio estado.
 * Si terminal.json no existe (instalación no registrada), el cron se omite.
 *
 * Cada 10 minutos reporta:
 * - Versión del backend
 * - Estado de la base de datos
 * - Tiempo activo del proceso (para detectar crash loops)
 * - Cantidad de errores pendientes de enviar
 *
 * Fallos silenciosos: si AdminServer no está disponible,
 * no se interrumpe la operación de la app.
 */

import axios from 'axios';
import config from '../conf/app.config';
import pkg from '../../package.json';
import path from 'path';
import fs from 'fs';
import db from '../db';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';

const cron = require('node-cron');

const ROOT_DIR = process.cwd();
// Mismo directorio que error.log — datos operativos de la app, no del updater
const ERRORES_PENDIENTES_PATH    = path.join(ROOT_DIR, 'src', 'log', 'errores-pendientes.json');
// Instrucción de rollback pendiente — la lee bootstrap.ts en el próximo arranque
const ROLLBACK_PENDIENTE_PATH           = path.join(ROOT_DIR, 'updater', 'pendiente-rollback.json');
// Evento de la última actualización/rollback del backend — se envía al AdminServer via heartbeat
const EVENTO_ACTUALIZACION_PATH         = path.join(ROOT_DIR, 'updater', 'evento-actualizacion.json');
// Evento de la última actualización del frontend — escrito por el endpoint POST /update/evento-front
const EVENTO_ACTUALIZACION_FRONT_PATH   = path.join(ROOT_DIR, 'updater', 'evento-actualizacion-front.json');
// Señal de que el front instaló una versión y está pendiente de confirmar que arrancó OK
const PENDIENTE_CONFIRMAR_FRONT_PATH    = path.join(ROOT_DIR, 'updater', 'pendiente-confirmar-front.json');
// Instrucción de rollback del frontend — la lee startup.service.ts en el próximo arranque
const ROLLBACK_FRONT_PENDIENTE_PATH     = path.join(ROOT_DIR, 'updater', 'pendiente-rollback-front.json');
// Estado del último intento de backup — escrito por backupService tras cada ejecución
const BACKUP_ESTADO_PATH                = path.join(ROOT_DIR, 'src', 'log', 'backup-estado.json');

class HeartbeatService {

    IniciarCron(): void {
        // Cada 10 minutos
        cron.schedule('*/10 * * * *', async () => {
            await this.Enviar();
        });

        logger.info({ type: 'HEARTBEAT_INFO', message: 'Cron de heartbeat iniciado (cada 10 min).', modulo: 'heartbeatService' });
    }

    async Enviar(): Promise<void> {
        try {
            const terminal = ObtenerTerminal();
            if (!terminal) return;

            const [dbStatus, tiempoActivo, erroresRecientes] = await Promise.all([
                VerificarDb(),
                Promise.resolve(Math.floor(process.uptime())),
                Promise.resolve(ContarErroresPendientes()),
            ]);

            // Lee los eventos de actualización pendientes de enviar (si existen).
            const eventoActualizacion      = LeerEventoPendiente();
            const eventoActualizacionFront = LeerEventoPendienteFront();
            const confirmacionFrontPendiente = fs.existsSync(PENDIENTE_CONFIRMAR_FRONT_PATH);

            const estadoBackup = LeerEstadoBackup();

            const respuesta = await axios.post(`${config.adminUrl}heartbeat`, {
                terminal,
                idApp:                     config.idApp,
                versionBack:               pkg.version,
                versionFront:              null,
                dbStatus,
                tiempoActivo,
                erroresRecientes,
                ultimoBackupFecha:         estadoBackup?.fecha ?? null,
                ultimoBackupOk:            estadoBackup !== null ? (estadoBackup.ok ? 1 : 0) : null,
                terminalesLanActivas:      1,
                eventoActualizacion,
                eventoActualizacionFront,
                confirmacionFrontPendiente,
            }, {
                timeout: 8000
            });

            // AdminServer confirmó recepción → eliminamos los eventos locales.
            if (eventoActualizacion && fs.existsSync(EVENTO_ACTUALIZACION_PATH)) {
                fs.unlinkSync(EVENTO_ACTUALIZACION_PATH);
            }
            if (eventoActualizacionFront && fs.existsSync(EVENTO_ACTUALIZACION_FRONT_PATH)) {
                fs.unlinkSync(EVENTO_ACTUALIZACION_FRONT_PATH);
            }

            // Si AdminServer instruyó un rollback de backend y aún no hay uno pendiente, lo registramos.
            if (respuesta.data?.rollback === true && !fs.existsSync(ROLLBACK_PENDIENTE_PATH)) {
                fs.writeFileSync(ROLLBACK_PENDIENTE_PATH, JSON.stringify({
                    instruccion: 'rollback',
                    fecha:       new Date().toISOString(),
                }, null, 2));

                logger.info({
                    type:    'HEARTBEAT_INFO',
                    message: 'Rollback de backend ordenado por AdminServer. Se aplicará en el próximo reinicio.',
                    modulo:  'heartbeatService'
                });
            }

            // Si AdminServer instruyó un rollback de frontend, guardamos versión y URL de descarga.
            const rollbackFront = respuesta.data?.rollbackFront;
            if (rollbackFront?.version && rollbackFront?.zipUrl && !fs.existsSync(ROLLBACK_FRONT_PENDIENTE_PATH)) {
                fs.writeFileSync(ROLLBACK_FRONT_PENDIENTE_PATH, JSON.stringify({
                    version: rollbackFront.version,
                    zipUrl:  rollbackFront.zipUrl,
                    fecha:   new Date().toISOString(),
                }, null, 2));

                logger.info({
                    type:    'HEARTBEAT_INFO',
                    message: `Rollback de frontend a v${rollbackFront.version} ordenado por AdminServer.`,
                    modulo:  'heartbeatService'
                });
            }

        } catch (error: any) {
            // Fallo silencioso: el heartbeat es informativo, no crítico.
            // IGNORAR_REMOTO: si no hay conectividad con AdminServer, el batch tampoco puede enviarse.
            logger.error({
                code:    CodigoError.HEARTBEAT_FALLIDO,
                message: error.message || 'Sin detalle de error',
                modulo:  'heartbeatService',
                cause:   error.cause?.message,  
                stack:   error.stack,
            });

            
        }
    }
}

function ObtenerTerminal(): string | null {
    const TERMINAL_FILE = path.join(ROOT_DIR, 'terminal.json');
    if (!fs.existsSync(TERMINAL_FILE)) return null;

    try {
        const data = JSON.parse(fs.readFileSync(TERMINAL_FILE, 'utf-8'));
        return data.terminal ?? null;
    } catch {
        return null;
    }
}

async function VerificarDb(): Promise<string> {
    try {
        const connection = await db.getConnection();
        connection.release();
        return 'ok';
    } catch {
        return 'error';
    }
}

function LeerEventoPendiente(): object | null {
    try {
        if (!fs.existsSync(EVENTO_ACTUALIZACION_PATH)) return null;
        return JSON.parse(fs.readFileSync(EVENTO_ACTUALIZACION_PATH, 'utf-8'));
    } catch {
        return null;
    }
}

function LeerEventoPendienteFront(): object | null {
    try {
        if (!fs.existsSync(EVENTO_ACTUALIZACION_FRONT_PATH)) return null;
        return JSON.parse(fs.readFileSync(EVENTO_ACTUALIZACION_FRONT_PATH, 'utf-8'));
    } catch {
        return null;
    }
}

interface EstadoBackup {
    fecha: string;
    ok:    boolean;
}

function LeerEstadoBackup(): EstadoBackup | null {
    try {
        if (!fs.existsSync(BACKUP_ESTADO_PATH)) return null;
        const data = JSON.parse(fs.readFileSync(BACKUP_ESTADO_PATH, 'utf-8'));
        if (typeof data.fecha !== 'string' || typeof data.ok !== 'boolean') return null;
        return data;
    } catch {
        return null;
    }
}

function ContarErroresPendientes(): number {
    try {
        if (!fs.existsSync(ERRORES_PENDIENTES_PATH)) return 0;
        const errores = JSON.parse(fs.readFileSync(ERRORES_PENDIENTES_PATH, 'utf-8'));
        return Array.isArray(errores)
            ? errores.reduce((acc: number, e: any) => acc + (e.cantidad ?? 1), 0)
            : 0;
    } catch {
        return 0;
    }
}

export const HeartbeatServ = new HeartbeatService();
