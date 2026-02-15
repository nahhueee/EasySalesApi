/**
 * CHEQUEO DE ACTUALIZACIONES
 * =========================
 * Este módulo se encarga exclusivamente de:
 * - Consultar al servidor administrativo
 * - Obtener la última versión publicada
 * - Compararla contra la versión local
 *
 * IMPORTANTE:
 * - NO descarga archivos
 * - NO aplica actualizaciones
 * - NO reinicia el sistema
 *
 * Su única responsabilidad es DESCRIBIR el estado actual
 * de versiones de forma segura y tolerante a fallos.
 */

import axios from 'axios';
import config from '../../src/conf/app.config';
import pkg from '../../package.json';
import path from 'path';
import fs from 'fs';
import { LoggerActualizacion as logger } from '../config/LogggerActualizacion';


/**
 * Metadatos fijos para logging estructurado.
 * Permiten identificar rápidamente:
 * - En qué fase ocurrió el evento
 * - En qué módulo exacto
 */
const fase: string = 'verificando_actualizacion';
const modulo: string = 'CheckearActualizacion';

/**
 * Consulta al servidor de actualizaciones y
 * devuelve un estado normalizado de versiones.
 */
export async function CheckearActualizacion() {
  try {

     /**
     * VALIDACION DE IDENTIDAD
     * -------------
     * Se obtiene el nro de terminal y mac del dispositivo para verificar si está usuario está habilitado para actualizar.
     */

    const terminal = ObtenerTerminalLocal(); 

    /**
     * CONSULTA AL SERVIDOR ADMINISTRATIVO
     * ----------------------------------
     * Se solicita únicamente:
     * - La última versión disponible para esta app
     *
     * El servidor:
     * - Decide cuál es la versión vigente
     * - Define si está habilitada para este cliente
     */

    const ambiente = config.produccion ? 'prod': 'test';
    const url = `${config.adminUrl}actualizaciones/ultima-version-backend/${config.idApp}/${ambiente}/${terminal}`;
    logger.info('Consultando al servidor.',{
        fase,
        modulo,
        url
      }
    );

    const respuesta = (await axios.get(url)).data;

    if (!respuesta || !respuesta.version) {
      throw new Error('Respuesta inválida del servidor de actualizaciones');
    }

    logger.info('Respuesta.',{ fase, modulo, respuesta });


    /**
     * VERSIÓN LOCAL
     * -------------
     * Se obtiene directamente desde package.json.
     * Es la versión REAL que está ejecutando el sistema.
     */
    const localVersion = pkg.version;

    /**
     * VERSIÓN REMOTA
     * --------------
     * Proviene del backend administrativo.
     * Representa la versión más reciente publicada.
     */
    const remoteVersion = respuesta.version;

    /**
     * COMPARACIÓN DE VERSIONES
     * ------------------------
     * Se utiliza comparación semántica básica (X.Y.Z).
     *
     * Posibles resultados:
     * - -1 → remote > local  → hay actualización disponible
     * -  0 → remote = local  → sistema actualizado
     * -  1 → remote < local  → intento de downgrade
     *
     * REGLA CRÍTICA:
     * Nunca se permite un downgrade automático.
     */
    const resultado = compararVersiones(localVersion, remoteVersion);
    let desactualizado = false;

    if (resultado === -1) {
      // Hay una versión más nueva disponible
      desactualizado = true;

    } else if (resultado === 1) {
      /**
       * Downgrade detectado
       * -------------------
       * Puede ocurrir por:
       * - error humano en el backend
       * - rollback manual del servidor
       * - entornos desincronizados
       *
       * En todos los casos:
       * - se ignora la actualización
       * - se registra un warning
       */
      logger.warn(
        'La versión remota es más vieja que la instalada. Se ignora la actualización.',
        {
          fase,
          modulo,
          localVersion,
          remoteVersion
        }
      );

    } else {
      // Versiones idénticas
      logger.info('La versión instalada está actualizada.', {
        fase,
        modulo,
        version: localVersion
      });
    }

    /**
     * OBJETO DE RESPUESTA NORMALIZADO
     * -------------------------------
     * Este objeto:
     * - NO contiene lógica
     * - NO toma decisiones
     * - Solo describe el estado actual
     *
     * Las decisiones se toman en:
     * - bootstrap
     * - DescargarActualizacion
     * - AplicarActualizacion
     */
    return {
      local: localVersion,        // versión instalada
      remote: remoteVersion,      // versión disponible
      desactualizado,             // booleano simple

      ambiente: respuesta.estado,        // prod | test 
      link: respuesta.link,            // URL del ZIP

      // Información informativa (changelog)
      notas: {
        resumen: respuesta.resumen,
        mejoras: respuesta.mejoras,
        correcciones: respuesta.correcciones
      },

      fecha: respuesta.fecha_publicacion          // fecha de publicación
    };

  } catch (error) {

    /**
     * MANEJO DE FALLOS
     * ----------------
     * Si algo falla:
     * - red
     * - timeout
     * - backend caído
     * - respuesta inválida
     *
     * Entonces:
     * - NO se cae el servidor
     * - NO se bloquea el arranque
     * - NO se intenta descargar nada
     *
     * Se asume que NO hay actualización disponible
     * y el sistema continúa en modo normal.
     */
    logger.error('No se pudo verificar actualizaciones. Se continúa sin actualizar.', {
      fase,
      modulo,
      error:
          error instanceof Error
            ? error.message
            : error
    });

    return {
      local: pkg.version,
      remote: null,
      desactualizado: false,
      error: true
    };
  }
}


function compararVersiones(local: string, remote: string): number {
  const l = local.split('.').map(Number);
  const r = remote.split('.').map(Number);

  for (let i = 0; i < Math.max(l.length, r.length); i++) {
    const lv = l[i] ?? 0;
    const rv = r[i] ?? 0;

    if (lv > rv) return 1;
    if (lv < rv) return -1;
  }

  return 0;
}

function ObtenerTerminalLocal(): string | null {
  const ROOT_DIR = process.cwd();
  const TERMINAL_FILE = path.join(ROOT_DIR, 'terminal.json');

    if (!fs.existsSync(TERMINAL_FILE)) throw new Error("No se ecuentra archivo terminal.json");

    const data = JSON.parse(fs.readFileSync(TERMINAL_FILE, 'utf-8'));
    return data.terminal ?? null;
}




