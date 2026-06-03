/**
 * EJECUTAR ROLLBACK
 * =================
 * Revierte la instalación al backup guardado en updater/backup/.
 *
 * Este módulo se activa cuando:
 * - AdminServer ordenó un rollback via heartbeat response
 * - bootstrap.ts encontró updater/pendiente-rollback.json al arrancar
 *
 * Qué hace:
 * 1. Verifica que el backup exista y tenga archivos
 * 2. Restaura src/ y package.json desde updater/backup/
 * 3. Elimina pendiente-rollback.json
 * 4. Retorna true → bootstrap reinicia el proceso
 *
 * Limitación Phase 1:
 * Solo puede revertir a la versión inmediatamente anterior (la que estaba
 * antes del último update). Rollbacks a versiones más antiguas requieren
 * descargar desde AdminServer — fuera del scope actual.
 */

import fs   from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { LoggerActualizacion as logger } from './LogggerActualizacion';

const ROOT_DIR             = path.resolve(__dirname, '../../');
const BACKUP_DIR           = path.join(ROOT_DIR, 'updater', 'backup');
const ROLLBACK_PENDIENTE   = path.join(ROOT_DIR, 'updater', 'pendiente-rollback.json');

const fase   = 'aplicando_rollback';
const modulo = 'EjecutarRollback';

export async function EjecutarRollback(): Promise<boolean> {

    if (!fs.existsSync(ROLLBACK_PENDIENTE)) {
        return false;
    }

    logger.info('Orden de rollback detectada. Iniciando reversión.', { fase, modulo });

    // Verifica que el backup tenga algo que restaurar.
    const backupSrc = path.join(BACKUP_DIR, 'src');
    if (!fs.existsSync(backupSrc)) {
        logger.warn(
            'No se encontró backup en updater/backup/src. Rollback cancelado.',
            { fase, modulo }
        );
        // Eliminamos el pendiente para no quedar en loop.
        fs.unlinkSync(ROLLBACK_PENDIENTE);
        return false;
    }

    try {
        const ITEMS_A_RESTAURAR = ['src', 'package.json'];

        for (const item of ITEMS_A_RESTAURAR) {
            const origen  = path.join(BACKUP_DIR, item);
            const destino = path.join(ROOT_DIR, item);

            if (!fs.existsSync(origen)) {
                logger.warn(`Backup de "${item}" no encontrado, se omite.`, { fase, modulo });
                continue;
            }

            logger.info(`Restaurando: ${item}`, { fase, modulo });
            copiarArchivos(origen, destino);
        }

        logger.info('Archivos restaurados correctamente. Limpiando pendiente.', { fase, modulo });
        fs.unlinkSync(ROLLBACK_PENDIENTE);

        EscribirEvento('rollback_exitoso', null, null);
        return true;

    } catch (error: any) {
        logger.error('Error durante el rollback.', {
            fase,
            modulo,
            error: error instanceof Error ? error.message : error
        });

        EscribirEvento('rollback_fallido', null, error instanceof Error ? error.message : String(error));
        // No eliminamos pendiente-rollback.json: el próximo arranque lo reintentará.
        return false;
    }
}

const EVENTO_PATH = path.join(ROOT_DIR, 'updater', 'evento-actualizacion.json');

function EscribirEvento(
    tipo: 'rollback_exitoso' | 'rollback_fallido',
    version: string | null,
    error: string | null
) {
    try {
        fs.writeFileSync(EVENTO_PATH, JSON.stringify({
            tipo,
            version,
            error,
            reintentos: 0,
            fecha: new Date().toISOString(),
        }, null, 2));
    } catch {
        // No crítico
    }
}

function copiarArchivos(sourcePath: string, targetPath: string) {
    if (!fs.existsSync(sourcePath)) {
        throw new Error(`Origen no existe: ${sourcePath}`);
    }

    const targetDir = fs.lstatSync(sourcePath).isDirectory()
        ? targetPath
        : path.dirname(targetPath);

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.lstatSync(sourcePath).isDirectory()) {
        execSync(`xcopy "${sourcePath}" "${targetPath}" /E /I /Y`, { stdio: 'ignore' });
    } else {
        execSync(`copy "${sourcePath}" "${targetPath}" /Y`, { stdio: 'ignore' });
    }
}
