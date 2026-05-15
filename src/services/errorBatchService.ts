/**
 * SERVICIO DE BATCH DE ERRORES
 * ============================
 * Acumula errores de runtime en disco y los envía en lotes a AdminServer.
 *
 * Motivación:
 * - Evitar una llamada HTTP por cada error (alto volumen en producción)
 * - Tolerar cortes de red: los errores se acumulan y se envían cuando haya conexión
 * - Deduplicación: errores repetidos se cuentan, no se duplican
 *
 * Características:
 * - Retención local máxima: 5 días (entradas más viejas se descartan)
 * - Cap por código: 500 ocurrencias máximas antes de descartar y registrar OVERFLOW
 * - Backoff exponencial: 15 → 30 → 60 → 120 → 240 min ante fallos consecutivos
 * - Idempotencia: cada envío lleva un batch_id UUID que AdminServer verifica
 *
 * Corre en toda instancia de EasySalesApi que tenga terminal.json presente.
 *
 * Flujo:
 * 1. ErrorBatchTransport (logger) llama a registrar(codigo, mensaje)
 * 2. Se acumula en src/log/errores-pendientes.json (agrupado por código)
 * 3. Cada 15 minutos, IniciarCron() evalúa si enviar el batch a AdminServer
 * 4. Si el envío falla, el archivo se preserva y el intervalo se extiende (backoff)
 */

import axios from 'axios';
import config from '../conf/app.config';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';

const cron = require('node-cron');

const ROOT_DIR = process.cwd();
const ERRORES_PENDIENTES_PATH = path.join(ROOT_DIR, 'src', 'log', 'errores-pendientes.json');

const MAX_ANTIGUEDAD_DIAS     = 5;
const MAX_CANTIDAD_POR_CODIGO = 500;

// Tiempo de espera en minutos según número de fallos consecutivos.
// Índice 0 = sin fallos (operación normal), índice 5+ = cap máximo.
const BACKOFF_MINUTOS = [0, 15, 30, 60, 120, 240];

interface ErrorPendiente {
    codigo:       string;
    mensaje:      string;
    cantidad:     number;
    fechaPrimero: string; // ISO 8601
    fechaUltimo:  string; // ISO 8601
}

class ErrorBatchService {

    private fallosConsecutivos = 0;
    // new Date(0) = pasado distante: siempre puede enviar al inicio
    private puedeEnviarDesde: Date = new Date(0);

    IniciarCron(): void {
        cron.schedule('*/15 * * * *', async () => {
            await this.EnviarBatch();
        });
    }

    /**
     * Registra un error en el buffer local.
     *
     * - Purga entradas más viejas de MAX_ANTIGUEDAD_DIAS antes de escribir.
     * - Si el código ya alcanzó MAX_CANTIDAD_POR_CODIGO, descarta y loguea overflow.
     * - Si el código ya existe, incrementa cantidad y actualiza fechaUltimo.
     * - Si no existe, agrega nueva entrada.
     *
     * Nota: el catch usa console.error para evitar re-entrada al transport de logging.
     */
    registrar(codigo: string, mensaje: string): void {
        try {
            const ahora  = new Date();
            let errores  = this._leerArchivo();

            // Purgar entradas viejas
            errores = this._purgarViejos(errores, ahora);

            const existente = errores.find(e => e.codigo === codigo);

            if (existente) {
                if (existente.cantidad >= MAX_CANTIDAD_POR_CODIGO) {
                    // Cap alcanzado: descartar y registrar solo en log local (IGNORAR_REMOTO)
                    logger.warn({
                        code:    CodigoError.ERROR_BATCH_OVERFLOW,
                        message: `Cap de ${MAX_CANTIDAD_POR_CODIGO} alcanzado para código: ${codigo}`,
                        modulo:  'errorBatchService'
                    });
                    return;
                }
                existente.cantidad++;
                existente.mensaje    = mensaje;
                existente.fechaUltimo = ahora.toISOString();
            } else {
                errores.push({
                    codigo,
                    mensaje,
                    cantidad:     1,
                    fechaPrimero: ahora.toISOString(),
                    fechaUltimo:  ahora.toISOString(),
                });
            }

            fs.writeFileSync(ERRORES_PENDIENTES_PATH, JSON.stringify(errores, null, 2));

        } catch (error: any) {
            // console.error intencional: evitar re-entrada al logger (y al transport)
            console.error('[errorBatchService] Error al registrar en buffer local:', error.message);
        }
    }

    /**
     * Envía todos los errores acumulados a AdminServer en una sola llamada.
     *
     * Aplica backoff exponencial si hay fallos consecutivos.
     * Incluye batch_id para garantizar idempotencia en AdminServer.
     * Solo limpia el archivo local si el envío fue exitoso.
     */
    async EnviarBatch(): Promise<void> {
        // Backoff: respetar el intervalo de espera ante fallos previos
        if (new Date() < this.puedeEnviarDesde) return;

        try {
            if (!fs.existsSync(ERRORES_PENDIENTES_PATH)) return;

            const errores: ErrorPendiente[] = this._leerArchivo();
            if (!errores || errores.length === 0) return;

            const terminal = ObtenerTerminal();
            if (!terminal) return;

            const batch_id = randomUUID();

            await axios.post(`${config.adminUrl}errores/batch`, {
                terminal,
                idApp:   config.idApp,
                batch_id,
                errores,
            }, {
                timeout: 8000
            });

            // Éxito: limpiar archivo y resetear backoff
            fs.unlinkSync(ERRORES_PENDIENTES_PATH);
            this.fallosConsecutivos = 0;
            this.puedeEnviarDesde   = new Date(0);

        } catch (error: any) {
            // Fallo: incrementar contador y calcular próximo intento con backoff
            this.fallosConsecutivos++;
            const idx     = Math.min(this.fallosConsecutivos, BACKOFF_MINUTOS.length - 1);
            const minutos = BACKOFF_MINUTOS[idx];
            this.puedeEnviarDesde = new Date(Date.now() + minutos * 60 * 1000);

            logger.error({
                code:              CodigoError.ERROR_BATCH_ENVIO_FALLIDO,
                message:           error.message,
                modulo:            'errorBatchService',
                fallosConsecutivos: this.fallosConsecutivos,
                proximoIntento:    this.puedeEnviarDesde.toISOString(),
            });
        }
    }

    /**
     * Lee el archivo de errores pendientes aplicando migración suave:
     * entries sin fechas (formato viejo) reciben la fecha actual.
     */
    private _leerArchivo(): ErrorPendiente[] {
        if (!fs.existsSync(ERRORES_PENDIENTES_PATH)) return [];

        try {
            const raw: any[] = JSON.parse(fs.readFileSync(ERRORES_PENDIENTES_PATH, 'utf-8'));
            const ahora = new Date().toISOString();

            return raw.map(e => ({
                codigo:       e.codigo       ?? '',
                mensaje:      e.mensaje      ?? '',
                cantidad:     e.cantidad     ?? 1,
                fechaPrimero: e.fechaPrimero ?? ahora,
                fechaUltimo:  e.fechaUltimo  ?? ahora,
            }));
        } catch {
            return [];
        }
    }

    /** Descarta entradas cuya fechaPrimero sea anterior a MAX_ANTIGUEDAD_DIAS días. */
    private _purgarViejos(errores: ErrorPendiente[], ahora: Date): ErrorPendiente[] {
        const limite = new Date(ahora);
        limite.setDate(limite.getDate() - MAX_ANTIGUEDAD_DIAS);
        return errores.filter(e => new Date(e.fechaPrimero) >= limite);
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

export const ErrorBatchServ = new ErrorBatchService();
