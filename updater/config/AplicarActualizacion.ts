/**
 * APLICAR ACTUALIZACIÓN
 * ====================
 * Este módulo es el encargado de aplicar una actualización YA DESCARGADA.
 *
 * Filosofía del diseño:
 * - Nunca asumir que todo va a salir bien
 * - Registrar cada paso crítico
 * - Poder reintentar de forma segura
 * - Poder volver atrás (rollback) si algo falla
 *
 * Este archivo NO descarga versiones nuevas.
 * Solo trabaja con una actualización marcada como "pendiente".
 */

import fs from 'fs';
import path from 'path';
import unzipper from 'unzipper';
import { execSync } from 'child_process';
import { LoggerActualizacion as logger } from '../config/LogggerActualizacion';



interface Pendiente {
  /** Versión a aplicar */
  version: string;

  /** Ruta absoluta al archivo ZIP descargado */
  zip: string;

  /** Fecha en la que se descargó la actualización */
  fecha: string;

  /** Cantidad de intentos de aplicación realizados */
  reintentos: number;

  /** Último error registrado (si falló) */
  ultimoError?: string;

  /**
   * Si false: se omite npm install durante la aplicación.
   * Ahorra 3-5 minutos en actualizaciones que no modifican dependencias.
   * Default: true (comportamiento conservador).
   */
  requiereNpmInstall?: boolean;

  /**
   * Estado actual de la actualización:
   * - pendiente  → descargada pero no aplicada
   * - aplicando  → en proceso
   * - fallo      → falló al aplicar
   * - bloqueado  → demasiados intentos fallidos
   */
  estado: 'pendiente' | 'aplicando' | 'fallo' | 'bloqueado';
}

// Directorio raíz del proyecto.
const ROOT_DIR = path.resolve(__dirname, '../../');

/**
 * Flag interno para saber si se llegó a completar el backup.
 * IMPORTANTE:
 * - Solo se intenta rollback si este flag es true
 */
let backupCompletado = false;

/**
 * Metadatos fijos para logging.
 * Permiten identificar rápidamente el origen del log.
 */
const fase: string = 'aplicando_actualizacion';
const modulo: string = 'AplicarActualizacion';

/**
 * Archivo que indica que existe una actualización pendiente.
 * Es la fuente de verdad del updater.
 *
 * Se crea al finalizar una descarga exitosa.
 * Se elimina solo cuando la versión se aplica correctamente.
 */
const PENDING_FILE = path.join(ROOT_DIR, 'updater/pendiente.json');

/**
 * Carpeta donde se almacenan los backups previos a una actualización.
 * Permite rollback si algo falla a mitad del proceso.
 */
const BACKUP_DIR   = path.join(ROOT_DIR, 'updater/backup');
const EVENTO_PATH  = path.join(ROOT_DIR, 'updater/evento-actualizacion.json');

export async function AplicarActualizacion() {

  /**
   * PASO 0 — Verificación rápida
   * ----------------------------
   * Si no existe pendiente.json:
   * - No hay nada que aplicar
   * - El sistema puede continuar normalmente
   */
  if (!fs.existsSync(PENDING_FILE)) {
    logger.info('No se encontraron actualizaciones pendientes.', { fase, modulo });
    return false;
  }

  /**
   * Lectura y validación del archivo pendiente.json.
   * Si está corrupto o ilegible:
   * - Se elimina
   * - Se evita un loop infinito
   */
  let pendiente: Pendiente;
  try {
    pendiente = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8'));
  } catch (err) {
    logger.error('Error leyendo pendiente.json.', {
      fase,
      modulo,
      error: err instanceof Error ? err.message : err
    });

    fs.unlinkSync(PENDING_FILE);
    return false;
  }

  /**
   * Protección anti-loop:
   * Si la actualización falló demasiadas veces,
   * se bloquea explícitamente para no romper el sistema.
   */
  if (pendiente.reintentos >= 3) {
    logger.warn(
      `Actualización bloqueada: ${pendiente.version} (${pendiente.reintentos} intentos fallidos)`,
      { fase, modulo }
    );

    pendiente.estado = 'bloqueado';
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pendiente, null, 2));
    return false;
  }

  /**
   * Validación del ZIP descargado.
   * Si no existe:
   * - No tiene sentido continuar
   * - Se elimina el pendiente para permitir nueva descarga
   */
  if (!fs.existsSync(pendiente.zip)) {
    logger.warn('ZIP no encontrado en la carpeta downloads.', { fase, modulo });

    fs.unlinkSync(PENDING_FILE);
    return false;
  }

  /**
   * Marcamos el inicio del intento de aplicación.
   * IMPORTANTE:
   * - Se escribe a disco ANTES de que algo pueda fallar
   * - Esto protege contra caídas abruptas del proceso
   */
  pendiente.estado = 'aplicando';
  pendiente.ultimoError = undefined;
  pendiente.reintentos = (pendiente.reintentos || 0) + 1;

  fs.writeFileSync(PENDING_FILE, JSON.stringify(pendiente, null, 2));

  logger.info(`Aplicando nueva versión: ${pendiente.version}`, { fase, modulo });

  try {
    /**
     * PASO 1 — BACKUP
     * ---------------
     * Se respaldan archivos críticos antes de tocar nada.
     * Si este paso falla, NO se continúa.
     */
    logger.info('Creando un backup.', { fase, modulo });

    const BACKUP_TARGETS = ['src', 'package.json', 'package-lock.json'];

    for (const item of BACKUP_TARGETS) {
      const origin = path.join(ROOT_DIR, item);
      if (fs.existsSync(origin)) {
        copiarArchivos(origin, path.join(BACKUP_DIR, item));
      }
    }

    backupCompletado = true;

    /**
     * PASO 2 — EXTRACCIÓN
     * -------------------
     * Se descomprime el ZIP directamente sobre ROOT_DIR.
     * Asume que el ZIP contiene la estructura correcta del proyecto.
     */
    logger.info('Extrayendo archivos de la actualización.', { fase, modulo });

    await new Promise((resolve, reject) => {
      const stream = fs
        .createReadStream(pendiente.zip)
        .pipe(unzipper.Extract({ path: ROOT_DIR }));

      stream.on('close', resolve);
      stream.on('error', reject);
    });

    /**
     * PASO 3 — DEPENDENCIAS
     * --------------------
     * Se ejecuta npm install solo si requiereNpmInstall = true (o no está definido).
     * Cuando false: se ahorra 3-5 minutos de instalación para actualizaciones
     * que no modifican dependencias (solo código fuente).
     */
    if (pendiente.requiereNpmInstall !== false) {
      logger.info('Instalando dependencias.', { fase, modulo });

      const packageJsonPath = path.join(ROOT_DIR, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        try {
          execSync('npm install', {
            stdio: 'pipe',
            cwd: ROOT_DIR,
            windowsHide: true,
            timeout: 300000 // 5 minutos
          });

          logger.info('Dependencias instaladas correctamente.', { fase, modulo });
        } catch (npmError) {
          logger.error('Error al instalar dependencias.', {
            fase,
            modulo,
            error: npmError instanceof Error ? npmError.message : npmError
          });

          throw new Error('Error al intentar instalar dependencias');
        }
      }
    } else {
      logger.info('npm install omitido (requiereNpmInstall = false).', { fase, modulo });
    }

    /**
     * PASO 4 — MIGRACIONES
     * -------------------
     * Se ejecutan migraciones solo si existe knexfile.js.
     * Fallar acá implica rollback completo.
     */
    logger.info('Verificando y ejecutando migraciones.', { fase, modulo });

    const knexfilePath = path.join(__dirname, '..', '..', 'scripts', 'knexfile.js');
    if (!fs.existsSync(knexfilePath)) {
      throw new Error('Falta knexfile.js.');
    }

    try {
      execSync(
        `npx knex migrate:latest --knexfile "${knexfilePath}" --env development`,
        {
          windowsHide: true,
          stdio: 'pipe'
        }
      );

      // execSync('npx run migrate:latest --knexfile knexfile.js --env development', {
      //   stdio: 'pipe',
      //   cwd: ROOT_DIR,
      //   windowsHide: true,
      //   timeout: 180000 // 3 minutos
      // });

      logger.info('Migraciones aplicadas correctamente.', { fase, modulo });
    } catch (migrationError) {
      logger.error('Error al ejecutar migraciones.', {
        fase,
        modulo,
        error:
          migrationError instanceof Error
            ? migrationError.message
            : migrationError
      });

      throw new Error('Error al migrar');
    }

    /**
     * PASO FINAL — ÉXITO
     * ------------------
     * Si llegamos acá:
     * - La versión quedó aplicada
     * - Se limpian archivos temporales
     * - Se informa al servidor
     */
    logger.info(`Versión ${pendiente.version} aplicada exitosamente.`, {fase, modulo});

    EscribirEvento('aplicacion_exitosa', pendiente.version, null, pendiente.reintentos);

    fs.unlinkSync(PENDING_FILE);
    if (fs.existsSync(pendiente.zip)) fs.unlinkSync(pendiente.zip);

    return true;

  } catch (error: any) {
    /**
     * MANEJO DE ERROR + ROLLBACK
     * -------------------------
     * Cualquier error en los pasos anteriores
     * deriva en intento de restauración.
     */
    logger.error('Error aplicando actualización.', {
      fase,
      modulo,
      error: error instanceof Error ? error.message : error
    });

    pendiente.estado = 'fallo';
    pendiente.ultimoError = error.message;
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pendiente, null, 2));

    EscribirEvento('aplicacion_fallida', pendiente.version, error.message, pendiente.reintentos);

    /**
     * ROLLBACK
     * --------
     * Solo se ejecuta si el backup fue completado correctamente.
     */
    if (backupCompletado) {
      logger.warn('Iniciando rollback de archivos.', { fase, modulo });

      try {
        const TO_RESTORE = ['src', 'package.json'];

        for (const item of TO_RESTORE) {
          const bkpPath = path.join(BACKUP_DIR, item);
          if (fs.existsSync(bkpPath)) {
            copiarArchivos(bkpPath, path.join(ROOT_DIR, item));
          }
        }

        logger.info('Archivos restaurados correctamente.', { fase, modulo });
      } catch (restoreErr) {
        logger.error(
          'Error crítico: No se pudo restaurar el backup.',
          {
            fase,
            modulo,
            error:
              restoreErr instanceof Error
                ? restoreErr.message
                : restoreErr
          }
        );
      }
    }

    /**
     * Se retorna false para que el bootstrap:
     * - Intente iniciar la versión previa
     * - No reinicie en loop
     */
    return false;
  }
}


function copiarArchivos(sourcePath: string, targetPath: string) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`El origen no existe: ${sourcePath}`);
  }

  // Asegurar que la carpeta destino exista
  const targetDir = fs.lstatSync(sourcePath).isDirectory()
    ? targetPath
    : path.dirname(targetPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  try {
    if (fs.lstatSync(sourcePath).isDirectory()) {
      // Carpeta: xcopy /E /I /Y
      execSync(`xcopy "${sourcePath}" "${targetPath}" /E /I /Y`, { stdio: 'ignore' });
    } else {
      // Archivo: copy /Y
      execSync(`copy "${sourcePath}" "${targetPath}" /Y`, { stdio: 'ignore' });
    }
  } catch (err: any) {
    throw new Error(`Error copiando ${sourcePath} → ${targetPath}: ${err.message}`);
  }
}

function EscribirEvento(
  tipo: 'aplicacion_exitosa' | 'aplicacion_fallida' | 'rollback_exitoso' | 'rollback_fallido',
  version: string,
  error: string | null,
  reintentos: number
) {
  try {
    fs.writeFileSync(EVENTO_PATH, JSON.stringify({
      tipo,
      version,
      error,
      reintentos,
      fecha: new Date().toISOString(),
    }, null, 2));
  } catch {
    // No crítico: si no se puede escribir el evento, no se interrumpe el flujo.
  }
}
