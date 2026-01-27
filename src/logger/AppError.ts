import { CodigoError } from "./CodigosError";

//  Error de aplicación estandarizado.
 
//  AppError representa **errores esperados y controlados** dentro del dominio
//  de la aplicación (negocio, validaciones, integraciones externas).
 
//  No debe usarse para errores de programación (bugs).
//  Es el único tipo de error que el middleware expone al frontend.
 
//  Flujo esperado:
//  * Service / Repo -> throw AppError
//  * Router         -> next(error)
//  * Middleware     -> log + response HTTP
 
export class AppError extends Error {
  
  //------------------------------------------
  // Código de error de negocio.
  // Permite identificar el tipo de fallo de forma consistente
  // y desacoplada del mensaje humano.
  
  // Ejemplos:
  // * - DNI_NO_ENCONTRADO
  // * - AFIP_TIMEOUT
  // * - AFIP_NO_DISPONIBLE
  code: CodigoError;

  //------------------------------------------
  // Código HTTP asociado al error.
  
  // Ejemplos comunes:
  // * - 400 → Error de validación
  // * - 401 → No autorizado
  // * - 403 → Prohibido
  // * - 404 → No encontrado
  // * - 409 → Conflicto
  // * - 500 → Error interno
  // * - 503 → Servicio externo no disponible
  status: number;

  //------------------------------------------
  // Contexto técnico adicional para debugging.
  // NO se expone al frontend.
  
  // Usar para indicar:
  // * - módulo
  // * - método
  // * - datos relevantes (ids, estados, etc.)
  
  // Ejemplo:
  // * { modulo: 'FacturacionService', metodo: 'createNextVoucher' }
  context?: any;

  //------------------------------------------
  // Contexto técnico adicional para debugging.
  // NO se expone al frontend.
  
  // Usar para indicar:
  // * - módulo
  // * - método
  // * - datos relevantes (ids, estados, etc.)
  
  // Ejemplo:
  // * { modulo: 'FacturacionService', metodo: 'createNextVoucher' }
  cause?: any;

  constructor(
    code: CodigoError,
    message: string,
    status = 500,
    context?: any,
    cause?: any
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.context = context;
    this.cause = cause;
  }
}
