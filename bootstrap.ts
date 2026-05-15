/**
 * BOOTSTRAP PRINCIPAL DEL SISTEMA
 * --------------------------------
 * Punto de entrada real de la aplicación. Orquesta el flujo completo
 * antes de levantar la API de negocio.
 *
 * Orden de ejecución:
 * 0) Verificar si hay rollback pendiente (mayor prioridad)
 * 1) Aplicar actualización ya descargada (si existe)
 * 2) Verificar si hay una nueva versión disponible
 * 3) Descargar actualización si corresponde
 *    3b) Auto-apply si la actualización es pequeña (< 50 MB)
 * 4) Iniciar la aplicación principal
 *
 * Regla de oro: el bootstrap NUNCA bloquea el arranque definitivo.
 * Ante cualquier falla en el updater, se intenta iniciar la versión actual.
 *
 * Todo el flujo queda logueado para diagnóstico remoto en clientes.
 */

import http from 'http';
import { CheckearActualizacion } from './updater/config/CheckearActualizacion';
import { DescargarActualizacion } from './updater/config/DescargarActualizacion';
import { AplicarActualizacion } from './updater/config/AplicarActualizacion';
import { EjecutarRollback } from './updater/config/EjecutarRollback';
import { LoggerActualizacion as logger } from './updater/config/LogggerActualizacion';
import isOnline from 'is-online';
import fs from 'fs';
import path from 'path';

const ROOT_DIR           = process.cwd();
const ROLLBACK_PENDIENTE = path.join(ROOT_DIR, 'updater', 'pendiente-rollback.json');
const BACKUP_SRC         = path.join(ROOT_DIR, 'updater', 'backup', 'src');

/**
 * Estados posibles del sistema.
 * Se exponen también vía /status para informar al frontend.
 */
type EstadoSistema =
  | 'iniciando'
  | 'aplicando_rollback'
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
     * 0️⃣ Verificar si AdminServer ordenó un rollback
     * ------------------------------------------------
     * Tiene prioridad sobre todo: si hay una instrucción de rollback,
     * revertimos antes de intentar aplicar actualizaciones o iniciar la app.
     * El archivo pendiente-rollback.json lo escribe heartbeatService.ts
     * cuando AdminServer responde con { rollback: true }.
     */
    estado.fase    = 'aplicando_rollback';
    estado.mensaje = 'Verificando rollback pendiente...';

    try {
      const revertido = await EjecutarRollback();
      if (revertido) {
        logger.info('Rollback aplicado. Reiniciando para cargar versión anterior.', {
          fase: estado.fase,
          modulo: 'bootstrap'
        });
        setTimeout(() => { statusServer.close(); process.exit(0); }, 2000);
        return;
      }
    } catch (rollbackErr) {
      // Error recuperable: EjecutarRollback falló inesperadamente.
      // Se continúa con el arranque normal — mejor levantar la versión
      // actual que quedar sin servicio.
      logger.error('Error inesperado en EjecutarRollback. Continuando arranque.', {
        fase:   estado.fase,
        modulo: 'bootstrap',
        error:  rollbackErr instanceof Error ? rollbackErr.message : rollbackErr
      });
    }

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
      // Error recuperable: AplicarActualizacion lanzó una excepción no controlada
      // (en condiciones normales maneja sus propios errores y retorna false).
      // El sistema continúa e intenta arrancar con la versión actual.
      logger.error('Excepción no controlada en AplicarActualizacion.', {
        fase:   estado.fase,
        modulo: 'bootstrap',
        error:  updateErr instanceof Error ? updateErr.message : updateErr
      });
    }

    /**
     * 2️⃣ Verificar si existe una nueva actualización
     */
    try {
      estado.fase = 'verificando_actualizacion';
      estado.mensaje = 'Verificando actualizaciones disponibles...';

      
      const conectado = await isOnline();
      if(conectado){

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

          /**
           * 3b AUTO-APPLY
           * --------------
           * Si la actualización es pequeña (< 50 MB y tamanoBytes informado),
           * la aplicamos en este mismo arranque en lugar de esperar el próximo.
           * Resultado: 1 reinicio en lugar de 2.
           */
          if (info.autoAplicar) {
            logger.info('Actualización elegible para auto-apply. Aplicando en este arranque.', {
              fase: estado.fase,
              modulo: 'bootstrap',
              tamanoBytes: info.tamanoBytes
            });

            estado.fase = 'aplicando_actualizacion';
            estado.mensaje = 'Aplicando actualización automática...';

            try {
              const aplicada = await AplicarActualizacion();

              if (aplicada) {
                logger.info('Auto-apply exitoso. Reiniciando para cargar nuevos binarios.', {
                  fase: estado.fase,
                  modulo: 'bootstrap'
                });

                setTimeout(() => {
                  statusServer.close();
                  process.exit(0);
                }, 2000);

                return;
              }
            } catch (autoApplyErr) {
              // Error recuperable: se continúa con el arranque normal.
              // La actualización quedó descargada y se aplicará en el próximo arranque.
              logger.error('Error en auto-apply. Se aplicará en el próximo arranque.', {
                fase: estado.fase,
                modulo: 'bootstrap',
                error: autoApplyErr instanceof Error ? autoApplyErr.message : autoApplyErr
              });
            }
          }

        } else {
          /**
           * Caso feliz: sistema actualizado.
           * IMPORTANTE se logea para evitar dudas en soporte.
           */
          if(!info.error){
            logger.info('Sistema actualizado. No se requieren acciones.', {
              fase: estado.fase,
              modulo: 'CheckearActualizacion',
              versionActual: info.local
            });
          }

        }
      }else{
        logger.warn(
          'Sin conectividad. Se omite verificación de actualizaciones.',
          { fase: estado.fase, modulo: 'bootstrap' }
        );
      }
      
    } catch (checkErr) {
      // Error recuperable: falló la verificación o descarga de actualización.
      // No es crítico — se continúa con el arranque normal.
      logger.error('Error en verificación/descarga de actualización.', {
        fase:   estado.fase,
        modulo: 'bootstrap',
        error:  checkErr instanceof Error ? checkErr.message : checkErr
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

    // Si hay backup disponible y aún no hay rollback pendiente,
    // programamos rollback automático para el próximo arranque.
    if (fs.existsSync(BACKUP_SRC) && !fs.existsSync(ROLLBACK_PENDIENTE)) {
      try {
        fs.writeFileSync(ROLLBACK_PENDIENTE, JSON.stringify({
          instruccion: 'rollback',
          fecha:       new Date().toISOString(),
          origen:      'auto_inicio_fallido',
        }, null, 2));
        logger.warn('App no pudo iniciar. Rollback automático programado para el próximo arranque.', {
          fase:   estado.fase,
          modulo: 'bootstrap'
        });
      } catch { /* no crítico */ }
    }

    process.exit(1);
  }
}

// Punto de entrada real
bootstrap();
