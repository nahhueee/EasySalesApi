/**
 * DESCARGAR ACTUALIZACIÓN
 * ======================
 * Este módulo se encarga de:
 * - Descargar una nueva versión del sistema
 * - Guardarla en disco de forma segura
 * - Marcarla como "pendiente" para ser aplicada
 *
 * IMPORTANTE:
 * - Este archivo NO aplica la actualización
 * - NO reinicia el sistema
 * - NO toca el código en ejecución
 *
 * La aplicación real de la versión ocurre
 * en el próximo arranque mediante AplicarActualizacion().
 */

import fs from 'fs';
import path from 'path';
import axios from 'axios';


/**
 * Directorio raíz del proyecto.
 * Se usa process.cwd() porque este módulo
 * se ejecuta desde el proceso principal.
 */
const ROOT_DIR = process.cwd();

/**
 * Carpeta donde se almacenan los ZIP descargados.
 *
 * Características:
 * - Persistente entre reinicios
 * - Permite descargas grandes
 * - No se limpia automáticamente
 *
 * La limpieza ocurre solo cuando:
 * - la versión se aplica con éxito
 * - se detecta una versión más nueva
 */
const DOWNLOAD_DIR = path.join(ROOT_DIR, 'updater/downloads');

/**
 * Archivo que indica que existe una actualización pendiente.
 * Es la fuente de verdad para AplicarActualizacion().
 *
 * Este archivo:
 * - Se crea al finalizar una descarga exitosa
 * - Se elimina solo cuando la versión se aplica correctamente
 */
const PENDING_FILE = path.join(ROOT_DIR, 'updater/pendiente.json');

/**
 * Descarga una actualización si corresponde.
 *
 * @param info Información devuelta por CheckearActualizacion
 *
 * Flujo general:
 * 1) Validar si hay algo para descargar
 * 2) Limpiar pendientes antiguos si es necesario
 * 3) Descargar el ZIP (si no existe)
 * 4) Registrar la actualización como pendiente
 */
export async function DescargarActualizacion(info: any) {

  /**
   * CONDICIÓN DE SALIDA RÁPIDA
   * -------------------------
   * Si:
   * - el sistema NO está desactualizado
   * - o no hay un link de descarga válido
   *
   * entonces no se hace absolutamente nada.
   */
  if (!info.desactualizado || !info.link) {
    return null;
  }

  /**
   * MANEJO DE VERSIONES PENDIENTES ANTIGUAS
   * --------------------------------------
   * Escenario posible:
   * - Se descargó una versión
   * - No se llegó a aplicar (reinicio, corte, error)
   * - Aparece una versión más nueva en el servidor
   *
   * En ese caso:
   * - Se elimina el pendiente viejo
   * - Se prioriza siempre la versión más reciente
   */
  if (fs.existsSync(PENDING_FILE)) {
    const pendiente = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8'));

    if (pendiente.version !== info.remote) {
      fs.unlinkSync(PENDING_FILE);
    }
  }

  /**
   * Asegurar la existencia del directorio de descargas.
   * Se crea solo si es necesario.
   */
  if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
  }

  /**
   * Ruta final del archivo ZIP.
   *
   * Se usa el número de versión como nombre
   * para evitar confusiones y colisiones.
   */
  const zipPath = path.join(DOWNLOAD_DIR, `${info.remote}.zip`);
  const partPath = `${zipPath}.part`;

  /**
   * DESCARGA IDEMPOTENTE
   * -------------------
   * Si el ZIP ya existe COMPLETO:
   * - No se vuelve a descargar
   * - Se reutiliza el archivo existente
   *
   * Esto permite:
   * - reintentos tras reinicios
   * - tolerancia a fallos de red
   * - evitar tráfico innecesario
   */
  if (fs.existsSync(zipPath)) {
    return zipPath;
  }

  /**
   * Restos de una descarga anterior que quedó a mitad de camino
   * (colgada por inactividad de red o proceso cortado). Se descarta:
   * un .part nunca se trata como válido, siempre se re-descarga entero.
   */
  if (fs.existsSync(partPath)) {
    fs.unlinkSync(partPath);
  }

  /**
   * DESCARGA DEL ZIP (STREAMING)
   * ----------------------------
   * Se utiliza streaming para:
   * - No cargar el archivo completo en memoria
   * - Permitir archivos grandes
   * - Ser más tolerante a entornos de pocos recursos
   *
   * WATCHDOG DE INACTIVIDAD
   * ------------------------
   * El `timeout` de axios en modo 'stream' solo cubre el tiempo hasta
   * recibir los headers de respuesta, NO la duración de la transferencia
   * del body. Si la conexión se degrada a mitad de descarga (típico de
   * internet inestable), el socket puede quedar "vivo" sin recibir datos
   * y depender del keepalive del SO para notarlo — puede tardar horas.
   * Por eso se mantiene un temporizador propio que se resetea en cada
   * chunk recibido y aborta la descarga si pasan INACTIVITY_TIMEOUT_MS
   * sin actividad.
   */
  const INACTIVITY_TIMEOUT_MS = 30000; // 30s sin recibir bytes → se aborta
  const controller = new AbortController();

  const response = await axios.get(info.link, {
    responseType: 'stream',
    timeout: 15000, // Timeout de conexión (hasta recibir headers)
    signal: controller.signal,
  });

  const writer = fs.createWriteStream(partPath);

  /**
   * Espera activa a que la descarga finalice.
   * La promesa:
   * - Se resuelve cuando el archivo está completo
   * - Se rechaza ante cualquier error de escritura, de lectura del stream
   *   de origen (con .pipe() los errores del stream de origen NO se
   *   reenvían automáticamente al destino, hay que escucharlos aparte),
   *   o por inactividad prolongada (watchdog)
   *
   * El watchdog rechaza la promesa DIRECTAMENTE en vez de solo llamar
   * controller.abort() y esperar a que eso dispare un 'error' en el
   * stream: la propagación de un abort a mitad de body no está
   * garantizada de forma consistente entre versiones de axios/Node.
   * abort() se llama igual, como mejor esfuerzo para liberar el socket,
   * pero la promesa no depende de que eso funcione.
   */
  try {
    await new Promise<void>((resolve, reject) => {
      let watchdog: ReturnType<typeof setTimeout>;

      const onInactividad = () => {
        controller.abort();
        reject(new Error(`Descarga sin actividad por más de ${INACTIVITY_TIMEOUT_MS / 1000}s`));
      };
      const resetWatchdog = () => {
        clearTimeout(watchdog);
        watchdog = setTimeout(onInactividad, INACTIVITY_TIMEOUT_MS);
      };
      resetWatchdog();

      response.data.on('data', resetWatchdog);
      response.data.on('error', (err: Error) => { clearTimeout(watchdog); reject(err); });
      writer.on('finish', () => { clearTimeout(watchdog); resolve(); });
      writer.on('error', (err: Error) => { clearTimeout(watchdog); reject(err); });

      response.data.pipe(writer);
    });
  } catch (err) {
    // Liberar el handle del archivo antes de que el próximo intento
    // intente borrar el .part (evita EBUSY/EPERM en Windows).
    writer.destroy();
    response.data.destroy?.();
    throw err;
  }

  /**
   * Descarga confirmada completa: recién ahora el archivo pasa a ser
   * el ZIP "de verdad". Antes de este punto, cualquier corte deja un
   * .part que el próximo intento descarta sin ambigüedad.
   */
  fs.renameSync(partPath, zipPath);

  /**
   * REGISTRO DE ACTUALIZACIÓN PENDIENTE
   * ----------------------------------
   * Este archivo:
   * - NO aplica la actualización
   * - Solo deja constancia de que está lista
   * - Será leído en el próximo arranque
   *
   * Es CRÍTICO que este paso ocurra
   * solo después de una descarga exitosa.
   */
  fs.writeFileSync(
    PENDING_FILE,
    JSON.stringify(
      {
        version: info.remote,            // Versión descargada
        zip: zipPath,                    // Ruta al ZIP
        descargado: new Date().toISOString(),
        reintentos: 0,                   // Intentos de aplicación
        ultimoError: '',
        /**
         * Si false: AplicarActualizacion omite npm install (~30s vs 3-5min).
         * Default true para ser conservador con datos faltantes.
         */
        requiereNpmInstall: info.requiereNpmInstall ?? true,
      },
      null,
      2
    )
  );

  /**
   * Se retorna true para indicar que:
   * - La descarga se realizó correctamente
   * - El sistema quedó listo para aplicar la versión
   *   en el próximo arranque
   */
  return true;
}
