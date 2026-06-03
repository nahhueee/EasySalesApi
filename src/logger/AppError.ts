import { CodigoError } from "./CodigosError";

/**
 * Error de aplicación estandarizado.
 *
 * Representa errores esperados y controlados del dominio: negocio,
 * validaciones, integraciones externas y errores operacionales de background.
 *
 * No debe usarse para errores de programación (bugs).
 *
 * Flujo HTTP:       Service → throw AppError → next(error) → errorMiddleware → response
 * Flujo background: logger.error({ code: CodigoError, message, ... })
 */
export class AppError extends Error {

  /** Código de dominio. Identifica el tipo de fallo de forma consistente
   *  y desacoplada del mensaje humano. */
  code: CodigoError;

  /** Código HTTP asociado al error.
   *  Opcional: los errores de background no tienen contexto HTTP.
   *  El errorMiddleware usa 500 como fallback si está ausente. */
  status?: number;

  /** Contexto técnico para debugging. NO se expone al frontend.
   *  Ejemplo: { modulo: 'FacturacionService', metodo: 'createNextVoucher' } */
  context?: any;

  /** Causa original encadenada. */
  cause?: any;

  constructor(
    code: CodigoError,
    message: string,
    status?: number,
    context?: any,
    cause?: any
  ) {
    super(message);
    this.code    = code;
    this.status  = status;
    this.context = context;
    this.cause   = cause;
  }
}
