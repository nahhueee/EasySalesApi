// ─── Tipos de severidad ─────────────────────────────────────────────────────
export type Severidad = 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA' | 'IGNORAR_REMOTO';

// ─── Catálogo de códigos de error ────────────────────────────────────────────
export enum CodigoError {

  // ── HTTP / dominio ────────────────────────────────────────────────────────

  /**
   * Datos de entrada inválidos (campo faltante, formato incorrecto, etc.).
   * Severidad: BAJA — error de usuario, no requiere atención del operador.
   */
  VALIDACION = 'VALIDACION',

  /**
   * Terminal solicitada no registrada en AdminServer.
   * Severidad: BAJA — puede indicar reinstalación o test.
   */
  TERMINAL_NO_ENCONTRADA = 'TERMINAL_NO_ENCONTRADA',

  /**
   * La terminal está bloqueada (habilitado = false) en AdminServer.
   * Severidad: BAJA — estado intencional, el operador lo controla.
   */
  AUTH_NO_HABILITADO = 'AUTH_NO_HABILITADO',

  /**
   * Los certificados AFIP no están configurados o están vencidos.
   * Causa típica: instalación nueva sin WSAA, vencimiento anual.
   * Severidad: ALTA — sin certificados no se puede facturar.
   * Acción: revisar carpeta de certificados en la terminal.
   */
  CERTIFICADOS = 'CERTIFICADOS',

  /**
   * AFIP tardó más de lo esperado en responder.
   * Causa típica: red lenta, AFIP con alta carga, corte intermitente.
   * Severidad: ALTA — impide facturación electrónica.
   * Acción: verificar conectividad y estado de servicios AFIP.
   */
  AFIP_TIMEOUT = 'AFIP_TIMEOUT',

  /**
   * AFIP no está disponible (sin respuesta, error de red).
   * Severidad: ALTA — impide facturación electrónica.
   * Acción: verificar estado del servicio AFIP y conectividad.
   */
  AFIP_NO_DISPONIBLE = 'AFIP_NO_DISPONIBLE',

  /**
   * AFIP respondió con un error técnico inesperado.
   * Severidad: ALTA — requiere revisión del mensaje de error.
   */
  AFIP_ERROR = 'AFIP_ERROR',

  /**
   * AFIP rechazó el comprobante (datos inválidos, inconsistencia).
   * Causa típica: datos de CAE incorrectos, punto de venta inactivo.
   * Severidad: MEDIA — ocurre en operación normal pero vale observar recurrencia.
   * Acción: revisar el mensaje de rechazo y corregir configuración.
   */
  AFIP_RECHAZO = 'AFIP_RECHAZO',

  /**
   * Error al generar el código QR del comprobante.
   * Severidad: BAJA — no bloquea la venta, solo afecta el QR impreso.
   */
  QR_ERROR = 'QR_ERROR',

  /**
   * Error en la comunicación con AdminServer.
   * Causa típica: AdminServer caído, timeout, respuesta inesperada.
   * Severidad: MEDIA — operativamente relevante, no bloquea el negocio.
   */
  ADMIN_SERVER_ERROR = 'ADMIN_SERVER_ERROR',

  /**
   * Falló la creación del registro de app-cliente en AdminServer.
   * Causa típica: DNI duplicado, error de BD en AdminServer.
   * Severidad: MEDIA — impide el alta de una nueva terminal.
   */
  APPCLIENTE_CREACION_ERROR = 'APPCLIENTE_CREACION_ERROR',

  /**
   * Recurso no encontrado.
   * Severidad: BAJA — error de cliente HTTP.
   */
  NOT_FOUND = 'NOT_FOUND',

  /**
   * Error interno no categorizado.
   * Causa típica: excepción inesperada, bug en código.
   * Severidad: ALTA — requiere investigación.
   */
  INTERNAL_ERROR = 'INTERNAL_ERROR',

  // ── Operacionales / background ────────────────────────────────────────────

  /**
   * El heartbeat no pudo contactar a AdminServer.
   * Causa típica: sin conectividad, AdminServer caído.
   * Severidad: IGNORAR_REMOTO — si no hay red, el batch tampoco puede enviarse.
   * Detección: AdminServer muestra ultimo_heartbeat por terminal en el panel.
   */
  HEARTBEAT_FALLIDO = 'HEARTBEAT_FALLIDO',

  /**
   * Falló la generación del archivo de backup (compresión, lectura de BD).
   * Severidad: CRITICA — el cliente no tiene respaldo ante pérdida de datos.
   * Acción: revisar espacio en disco y permisos. Corregir antes del próximo ciclo.
   */
  BACKUP_GENERACION_ERROR = 'BACKUP_GENERACION_ERROR',

  /**
   * Backup generado correctamente pero no pudo subirse a AdminServer.
   * Severidad: ALTA — el archivo local existe, pero no hay copia remota.
   * Acción: verificar conectividad y disponibilidad del endpoint de backups.
   */
  BACKUP_UPLOAD_ERROR = 'BACKUP_UPLOAD_ERROR',

  /**
   * El ErrorBatchService no pudo enviar el lote de errores a AdminServer.
   * Severidad: IGNORAR_REMOTO — misma paradoja que HEARTBEAT_FALLIDO.
   */
  ERROR_BATCH_ENVIO_FALLIDO = 'ERROR_BATCH_ENVIO_FALLIDO',

  /**
   * Se alcanzó el cap de 500 entradas para un código en errores-pendientes.json.
   * Entradas excedentes descartadas para evitar consumo descontrolado de disco.
   * Severidad: IGNORAR_REMOTO — solo relevante en log local para diagnóstico.
   */
  ERROR_BATCH_OVERFLOW = 'ERROR_BATCH_OVERFLOW',

  /**
   * La conexión a la base de datos MySQL falló.
   * Severidad: CRITICA — sin BD el sistema no puede operar.
   * Acción: verificar estado del proceso MySQL y credenciales.
   */
  DB_CONNECTION_ERROR = 'DB_CONNECTION_ERROR',

  /**
   * Un cron job (backup, heartbeat, error batch) no pudo inicializarse.
   * Severidad: ALTA — el servicio en background no está corriendo.
   * Acción: revisar logs de arranque y reiniciar si es necesario.
   */
  CRON_INIT_ERROR = 'CRON_INIT_ERROR',

  /**
   * Falló la aplicación de una actualización automática.
   * Causa típica: error de copia de archivos, falta de espacio, permisos.
   * Severidad: CRITICA — la terminal puede quedar en estado inconsistente.
   * Acción: revisar logs del updater. Considerar rollback manual.
   */
  UPDATER_APPLY_ERROR = 'UPDATER_APPLY_ERROR',

  /**
   * Falló la ejecución de un rollback ordenado por AdminServer.
   * Severidad: CRITICA — la terminal quedó con la versión problemática.
   * Acción: intervención manual. Revisar backup disponible.
   */
  ROLLBACK_FALLIDO = 'ROLLBACK_FALLIDO',

  /**
   * Falló la aplicación de una migración de base de datos.
   * Severidad: CRITICA — el esquema puede estar incompleto o corrupto.
   * Acción: no reintentar automáticamente. Intervención manual requerida.
   */
  MIGRATION_ERROR = 'MIGRATION_ERROR',
}

// ─── Mapa de severidades ─────────────────────────────────────────────────────
export const SEVERIDAD: Record<CodigoError, Severidad> = {
  // HTTP / dominio
  [CodigoError.VALIDACION]:                'BAJA',
  [CodigoError.TERMINAL_NO_ENCONTRADA]:    'BAJA',
  [CodigoError.AUTH_NO_HABILITADO]:        'BAJA',
  [CodigoError.CERTIFICADOS]:              'ALTA',
  [CodigoError.AFIP_TIMEOUT]:              'ALTA',
  [CodigoError.AFIP_NO_DISPONIBLE]:        'ALTA',
  [CodigoError.AFIP_ERROR]:                'ALTA',
  [CodigoError.AFIP_RECHAZO]:              'MEDIA',
  [CodigoError.QR_ERROR]:                  'BAJA',
  [CodigoError.ADMIN_SERVER_ERROR]:        'MEDIA',
  [CodigoError.APPCLIENTE_CREACION_ERROR]: 'MEDIA',
  [CodigoError.NOT_FOUND]:                 'BAJA',
  [CodigoError.INTERNAL_ERROR]:            'ALTA',
  // Operacionales
  [CodigoError.HEARTBEAT_FALLIDO]:         'IGNORAR_REMOTO',
  [CodigoError.BACKUP_GENERACION_ERROR]:   'CRITICA',
  [CodigoError.BACKUP_UPLOAD_ERROR]:       'ALTA',
  [CodigoError.ERROR_BATCH_ENVIO_FALLIDO]: 'IGNORAR_REMOTO',
  [CodigoError.ERROR_BATCH_OVERFLOW]:      'IGNORAR_REMOTO',
  [CodigoError.DB_CONNECTION_ERROR]:       'CRITICA',
  [CodigoError.CRON_INIT_ERROR]:           'ALTA',
  [CodigoError.UPDATER_APPLY_ERROR]:       'CRITICA',
  [CodigoError.ROLLBACK_FALLIDO]:          'CRITICA',
  [CodigoError.MIGRATION_ERROR]:           'CRITICA',
};

/** Niveles que se envían a AdminServer vía ErrorBatchService. */
export const UMBRAL_ENVIO: Severidad[] = ['CRITICA', 'ALTA', 'MEDIA'];

/**
 * Retorna true si el código tiene severidad suficiente para encolarse
 * en ErrorBatchService y llegar a AdminServer.
 * Default conservador: código desconocido → IGNORAR_REMOTO → false.
 */
export function debeEnviar(codigo: CodigoError | string): boolean {
  const sev = SEVERIDAD[codigo as CodigoError] ?? 'IGNORAR_REMOTO';
  return UMBRAL_ENVIO.includes(sev);
}
