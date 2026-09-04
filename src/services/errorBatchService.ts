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
 * - Agrupación por HUELLA (código + mensaje normalizado + módulo), no por código:
 *   INTERNAL_ERROR se usa en decenas de rutas distintas, agrupar solo por código
 *   mezclaba errores no relacionados y pisaba el mensaje con el último que entrara.
 * - Cap por huella: 500 ocurrencias máximas antes de descartar y registrar OVERFLOW
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
import { randomUUID, createHash } from 'crypto';
import { logger } from '../logger/logger';
import { CodigoError } from '../logger/CodigosError';
import moment from 'moment';

const cron = require('node-cron');

const ROOT_DIR = process.cwd();
const ERRORES_PENDIENTES_PATH = path.join(ROOT_DIR, 'src', 'log', 'errores-pendientes.json');

const MAX_ANTIGUEDAD_DIAS     = 5;
const MAX_CANTIDAD_POR_CODIGO = 500;

// Techo de huellas distintas en el archivo. Sin esto, un mensaje con un dato
// variable que la normalización no alcance a limpiar podría generar una entrada
// nueva por ocurrencia y hacer crecer el archivo sin control.
const MAX_HUELLAS_DISTINTAS = 100;

// Recortes del detalle: el batch es telemetría, no el log completo. El detalle
// entero sigue estando en src/log/error.log de la terminal.
const MAX_LEN_MENSAJE = 500;
const MAX_LEN_CAUSA   = 300;
const MAX_LEN_RUTA    = 200;
const FRAMES_STACK    = 3;

// Tiempo de espera en minutos según número de fallos consecutivos.
// Índice 0 = sin fallos (operación normal), índice 5+ = cap máximo.
const BACKOFF_MINUTOS = [0, 15, 30, 60, 120, 240];

/**
 * Detalle del último evento de una huella. Todo opcional: los errores de
 * background no tienen contexto HTTP, y los del front no tienen módulo.
 * Se pisa en cada ocurrencia — interesa el más reciente, no el primero.
 */
export interface DetalleError {
    route?:      string;  // ruta del backend donde ocurrió (errorMiddleware)
    metodoHttp?: string;  // GET/POST/...
    modulo?:     string;  // AppError.context.modulo
    metodo?:     string;  // AppError.context.metodo
    pantalla?:   string;  // ruta del front (la manda GlobalErrorHandler del App)
    causa?:      string;  // AppError.cause.message
    stack?:      string;  // primeras FRAMES_STACK frames
}

interface ErrorPendiente extends DetalleError {
    codigo:       string;
    // Clave real de agrupación. Ver _calcularHuella().
    huella:       string;
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
     * - Agrupa por huella (codigo + mensaje normalizado + módulo/ruta), no por código.
     * - Si la huella ya alcanzó MAX_CANTIDAD_POR_CODIGO, descarta y loguea overflow.
     * - Si la huella ya existe, incrementa cantidad, actualiza fechaUltimo y pisa el detalle.
     * - Si no existe, agrega nueva entrada (salvo que se haya llegado a MAX_HUELLAS_DISTINTAS).
     *
     * Nota: el catch usa console.error para evitar re-entrada al transport de logging.
     */
    registrar(codigo: string, mensaje: string, detalle?: DetalleError): void {
        try {
            const ahora  = new Date();
            let errores  = this._leerArchivo();

            // Purgar entradas viejas
            errores = this._purgarViejos(errores, ahora);

            const mensajeCorto = _recortar(mensaje, MAX_LEN_MENSAJE);
            const detalleCorto = _recortarDetalle(detalle);
            const huella       = this._calcularHuella(codigo, mensajeCorto, detalleCorto);

            const existente = errores.find(e => e.codigo === codigo && e.huella === huella);

            if (existente) {
                if (existente.cantidad >= MAX_CANTIDAD_POR_CODIGO) {
                    // Cap alcanzado: descartar y registrar solo en log local (IGNORAR_REMOTO)
                    logger.warn({
                        code:    CodigoError.ERROR_BATCH_OVERFLOW,
                        message: `Cap de ${MAX_CANTIDAD_POR_CODIGO} alcanzado para código: ${codigo} (huella ${huella})`,
                        modulo:  'errorBatchService'
                    });
                    return;
                }
                existente.cantidad++;
                existente.mensaje     = mensajeCorto;
                existente.fechaUltimo = moment(ahora).format('YYYY-MM-DD HH:mm:ss');
                // El detalle refleja la ocurrencia más reciente
                Object.assign(existente, detalleCorto);
            } else {
                // Techo de huellas: por encima del límite dejamos de abrir entradas nuevas
                // en vez de dejar crecer el archivo. Las huellas ya presentes siguen
                // contando ocurrencias normalmente.
                if (errores.length >= MAX_HUELLAS_DISTINTAS) {
                    logger.warn({
                        code:    CodigoError.ERROR_BATCH_OVERFLOW,
                        message: `Cap de ${MAX_HUELLAS_DISTINTAS} huellas distintas alcanzado — se descarta: ${codigo} / ${mensajeCorto}`,
                        modulo:  'errorBatchService'
                    });
                    return;
                }

                errores.push({
                    codigo,
                    huella,
                    mensaje:      mensajeCorto,
                    cantidad:     1,
                    fechaPrimero: moment(ahora).format('YYYY-MM-DD HH:mm:ss'),
                    fechaUltimo:  moment(ahora).format('YYYY-MM-DD HH:mm:ss'),
                    ...detalleCorto,
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
                // schema 2: cada error trae huella + detalle (route/modulo/causa/stack).
                // Un AdminServer viejo ignora los campos extra y sigue funcionando.
                schema:  2,
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
                code:               CodigoError.ERROR_BATCH_ENVIO_FALLIDO,
                message:            error.message || 'Fallo al enviar batch de errores',
                modulo:             'errorBatchService',
                cause:              error.cause?.message,
                stack:              error.stack,
                fallosConsecutivos: this.fallosConsecutivos,
                proximoIntento:     this.puedeEnviarDesde.toISOString(),
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

            return raw.map(e => {
                const codigo  = e.codigo  ?? '';
                const mensaje = e.mensaje ?? '';

                const detalle: DetalleError = {
                    route:      e.route,
                    metodoHttp: e.metodoHttp,
                    modulo:     e.modulo,
                    metodo:     e.metodo,
                    pantalla:   e.pantalla,
                    causa:      e.causa,
                    stack:      e.stack,
                };

                return {
                    codigo,
                    // Entradas del formato viejo (sin huella) reciben la suya calculada:
                    // así se fusionan con las nuevas del mismo error en vez de duplicarse.
                    huella:       e.huella ?? this._calcularHuella(codigo, mensaje, detalle),
                    mensaje,
                    cantidad:     e.cantidad     ?? 1,
                    fechaPrimero: e.fechaPrimero ?? ahora,
                    fechaUltimo:  e.fechaUltimo  ?? ahora,
                    ...detalle,
                };
            });
        } catch {
            return [];
        }
    }

    /**
     * Clave de agrupación de una ocurrencia.
     *
     * Se calcula sobre el mensaje NORMALIZADO (números, UUIDs y comillas reemplazados)
     * más el origen (módulo o ruta): "Producto 45 inexistente" y "Producto 78 inexistente"
     * tienen que contar como el mismo problema, y dos INTERNAL_ERROR de rutas distintas
     * NO tienen que contar como el mismo.
     *
     * Hash corto y no criptográfico a propósito: solo necesita ser estable y comparable.
     */
    private _calcularHuella(codigo: string, mensaje: string, detalle?: DetalleError): string {
        const origen = detalle?.modulo ?? detalle?.pantalla ?? detalle?.route ?? '';

        const normalizado = (mensaje || '')
            .toLowerCase()
            .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '#uuid')
            .replace(/\d+/g, '#')
            .replace(/['"`]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        return createHash('sha1')
            .update(`${codigo}|${normalizado}|${origen}`)
            .digest('hex')
            .slice(0, 10);
    }

    /** Descarta entradas cuya fechaPrimero sea anterior a MAX_ANTIGUEDAD_DIAS días. */
    private _purgarViejos(errores: ErrorPendiente[], ahora: Date): ErrorPendiente[] {
        const limite = new Date(ahora);
        limite.setDate(limite.getDate() - MAX_ANTIGUEDAD_DIAS);
        return errores.filter(e => new Date(e.fechaPrimero) >= limite);
    }
}

/** Recorta un texto a `max` caracteres, marcando el corte. */
function _recortar(texto: string | undefined, max: number): string {
    if (!texto) return '';
    return texto.length <= max ? texto : `${texto.slice(0, max)}…`;
}

/**
 * Deja el detalle en un tamaño apto para telemetría.
 * Del stack se guardan solo las primeras FRAMES_STACK frames: alcanzan para
 * ubicar el punto de falla, y el stack completo queda igual en error.log local.
 */
function _recortarDetalle(detalle?: DetalleError): DetalleError {
    if (!detalle) return {};

    const stackCorto = detalle.stack
        ? detalle.stack.split('\n').slice(0, FRAMES_STACK + 1).join('\n')
        : undefined;

    const limpio: DetalleError = {
        route:      detalle.route      ? _recortar(detalle.route, MAX_LEN_RUTA) : undefined,
        metodoHttp: detalle.metodoHttp,
        modulo:     detalle.modulo,
        metodo:     detalle.metodo,
        pantalla:   detalle.pantalla   ? _recortar(detalle.pantalla, MAX_LEN_RUTA) : undefined,
        causa:      detalle.causa      ? _recortar(detalle.causa, MAX_LEN_CAUSA)   : undefined,
        stack:      stackCorto,
    };

    // Sacamos las claves vacías para no ensuciar el JSON ni el payload
    (Object.keys(limpio) as (keyof DetalleError)[]).forEach(k => {
        if (limpio[k] === undefined || limpio[k] === '') delete limpio[k];
    });

    return limpio;
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
