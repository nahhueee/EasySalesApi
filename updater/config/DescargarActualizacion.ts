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

  /**
   * DESCARGA IDEMPOTENTE
   * -------------------
   * Si el ZIP ya existe:
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
   * DESCARGA DEL ZIP (STREAMING)
   * ----------------------------
   * Se utiliza streaming para:
   * - No cargar el archivo completo en memoria
   * - Permitir archivos grandes
   * - Ser más tolerante a entornos de pocos recursos
   */
  const response = await axios.get(info.link, {
    responseType: 'stream',
    timeout: 15000 // Timeout defensivo
  });

  const writer = fs.createWriteStream(zipPath);
  response.data.pipe(writer);

  /**
   * Espera activa a que la descarga finalice.
   * La promesa:
   * - Se resuelve cuando el archivo está completo
   * - Se rechaza ante cualquier error de escritura
   */
  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

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
