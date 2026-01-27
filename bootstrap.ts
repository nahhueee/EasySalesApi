/**
 * BOOTSTRAP PRINCIPAL DEL SISTEMA
 * --------------------------------
 * Este archivo es el punto de entrada real de la aplicación.
 * Su responsabilidad es:
 * 1) Levantar un servidor de estado (health / mantenimiento)
 * 2) Intentar aplicar una actualización ya descargada
 * 3) Verificar si hay nuevas actualizaciones
 * 4) Descargar actualizaciones si corresponde
 * 5) Iniciar la aplicación principal
 *
 * TODO el flujo está logueado para diagnóstico remoto en clientes.
 */

import http from 'http';
import { CheckearActualizacion } from './updater/config/CheckearActualizacion';
import { DescargarActualizacion } from './updater/config/DescargarActualizacion';
import { AplicarActualizacion } from './updater/config/AplicarActualizacion';
import { LoggerActualizacion as logger } from './updater/config/LogggerActualizacion';

/**
 * Estados posibles del sistema.
 * Se exponen también vía /status para informar al frontend.
 */
type EstadoSistema =
  | 'iniciando'
  | 'aplicando_actualizacion'
  | 'verificando_actualizacion'
  | 'descargando_actualizacion'
  | 'reiniciando'
  | 'listo'
  | 'error';

/**
 * Estado compartido del sistema.
 * IMPORTANTE:
 * - Este objeto representa la "verdad" del updater
 * - Lo consume el servidor de estado
 * - También se refleja en los logs
 */
const estado = {
  fase: 'iniciando' as EstadoSistema,
  mensaje: 'Iniciando sistema...',
};

/**
 * Servidor HTTP liviano SOLO para estado del sistema.
 * Se levanta antes de cualquier cosa crítica.
 *
 * Objetivo:
 * - Permitir saber en qué estado quedó el sistema
 * - Indicar si está en mantenimiento, error o listo
 */
const statusServer = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(estado));
    return;
  }

  res.writeHead(503);
  res.end('Sistema en mantenimiento');
});

statusServer.listen(7501, () => {
  logger.info('Servidor de estado activo.', {
    fase: estado.fase,
    modulo: 'statusServer',
    puerto: 7501
  });
});

/**
 * BOOTSTRAP PRINCIPAL
 * ------------------
 * Orquesta TODO el flujo de actualización + arranque.
 * Si algo falla:
 * - Se loguea
 * - Se intenta continuar siempre que sea seguro
 */
async function bootstrap() {
  try {
    /**
     * 1️⃣ Intentar aplicar una actualización YA DESCARGADA
     * Esto permite:
     * - Que una actualización descargada en un arranque anterior se aplique correctamente
     * - Evitar estados intermedios inconsistentes
     */
    estado.fase = 'aplicando_actualizacion';
    estado.mensaje = 'Aplicando actualización...';

    logger.info('Iniciando modulo AplicarActualizacion.', {
      fase: estado.fase,
      modulo: 'bootstrap'
    });

    try {
      const aplicada = await AplicarActualizacion();

      // Si se aplicó una actualización:
      // - Se debe salir del proceso
      // - PM2 / servicio reiniciará con el código nuevo
      if (aplicada) {
        logger.info(
          'Actualización aplicada con éxito. Reiniciando para cargar nuevos binarios.',
          { fase: estado.fase, modulo: 'bootstrap' }
        );

        setTimeout(() => {
          statusServer.close();
          process.exit(0);
        }, 2000);

        return;
      }
    } catch (updateErr) {
      /**
       * ERROR RECUPERABLE
       * -----------------
       * Falló la aplicación de la actualización,
       * pero el sistema puede continuar e intentar iniciar la app.
       */
      logger.error('Error crítico en el flujo de actualización.', {
        fase: estado.fase,
        modulo: 'AplicarActualizacion',
        error: updateErr instanceof Error ? updateErr.message : updateErr
      });
    }

    /**
     * 2️⃣ Verificar si existe una nueva actualización
     */
    try {
      estado.fase = 'verificando_actualizacion';
      estado.mensaje = 'Verificando actualizaciones disponibles...';

      logger.info('Iniciando modulo CheckearActualizacion.', {
        fase: estado.fase,
        modulo: 'bootstrap'
      });

      const info = await CheckearActualizacion();

      if (info.desactualizado) {
        /**
         * 3️⃣ Descargar actualización si el sistema está desactualizado
         * NO se aplica acá, solo se descarga.
         */
        estado.fase = 'descargando_actualizacion';
        estado.mensaje = 'Descargando actualización...';

        logger.info('Iniciando modulo DescargarActualizacion.', {
          fase: estado.fase,
          modulo: 'bootstrap'
        });

        await DescargarActualizacion(info);
      } else {
        /**
         * Caso feliz: sistema actualizado.
         * IMPORTANTE se logea para evitar dudas en soporte.
         */
        logger.info('Sistema actualizado. No se requieren acciones.', {
          fase: estado.fase,
          modulo: 'CheckearActualizacion',
          versionActual: info.local
        });
      }
    } catch (checkErr) {
      /**
       * ERROR RECUPERABLE
       * -----------------
       * No se pudo verificar o descargar actualización.
       * Se continúa intentando iniciar la aplicación.
       */
      logger.error('Error crítico en el flujo de actualización.', {
        fase: estado.fase,
        modulo: 'CheckearActualizacion',
        error: checkErr instanceof Error ? checkErr.message : checkErr
      });
    }

    /**
     * 4️⃣ Arranque normal de la aplicación
     */
    estado.fase = 'listo';
    estado.mensaje = 'Iniciando aplicación...';

    logger.info('Proceso de actualizacion finalizado, levantando app.', {
      fase: estado.fase,
      modulo: 'bootstrap'
    });

    await iniciarApp();

    // Una vez iniciada la app real, el servidor de estado ya no es necesario
    statusServer.close();

    logger.info('Sistema operativo y servidor de estado cerrado.', {
      fase: estado.fase,
      modulo: 'bootstrap'
    });

  } catch (err: any) {
    /**
     * ERROR FATAL
     * -----------
     * Algo salió MUY mal fuera de los flujos controlados.
     * El sistema entra en modo degradado.
     */
    estado.fase = 'error';
    estado.mensaje = 'Error en sistema de actualización';

    logger.error(
      'Error fatal en bootstrap. El servidor de estado quedará abierto.',
      {
        fase: estado.fase,
        modulo: 'bootstrap',
        fatal: true,
        error: err instanceof Error ? err.message : err
      }
    );

    /**
     * Último intento:
     * Se intenta iniciar la app de todos modos.
     * Si falla, el proceso muere y queda evidencia en logs.
     */
    logger.info('Intentando iniciar la app de todos modos.', {
      fase: estado.fase,
      modulo: 'bootstrap'
    });

    await iniciarApp();
  }
}

/**
 * Arranque de la aplicación real.
 * Si esto falla:
 * - No hay mucho más que hacer
 * - Se registra el error
 * - Se termina el proceso
 */
async function iniciarApp() {
  try {
    await import('./src/index');
  } catch (err) {
    logger.error('No se pudo iniciar la app.', {
      fase: estado.fase,
      modulo: 'bootstrap',
      error: err instanceof Error ? err.message : err
    });

    process.exit(1);
  }
}

// Punto de entrada real
bootstrap();
