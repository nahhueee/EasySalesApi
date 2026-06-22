// Validación de consistencia fiscal AFIP/ARCA, server-side.
// Defensa en profundidad: el frontend (datos-fiscales.validators.ts en EasySalesApp) ya aplica
// estas mismas reglas, pero el backend no debe confiar en eso — los datos pueden llegar por
// otra vía (API directa, bug de UI, futura integración). Usado por clientesRepository (alta/
// modificación de cliente) y facturacionService (chequeo previo a llamar a ARCA).

// Condiciones IVA que, por normativa AFIP, exigen CUIT como único documento válido del receptor.
export const CONDICIONES_IVA_CUIT_OBLIGATORIO = [1, 6, 13, 4];

const CUIT = 80;
const CUIL = 86;
const DNI = 96;
const CDI = 87;
const SIN_IDENTIFICAR = 99; // Marca local (no es código AFIP): solo válida para alta de cliente

const MULTIPLICADORES_CUIT = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export function EsCuitCuilValido(valor: string): boolean {
  if (!/^[0-9]{11}$/.test(valor)) return false;

  const digitos = valor.split('').map(Number);
  const suma = digitos.slice(0, 10).reduce((acc, d, i) => acc + d * MULTIPLICADORES_CUIT[i], 0);
  const resto = suma % 11;

  let verificador = 11 - resto;
  if (verificador === 11) verificador = 0;
  if (verificador === 10) return false; // No existe CUIT/CUIL válido para este resto

  return verificador === digitos[10];
}

function EsDniValido(valor: string): boolean {
  return /^[0-9]{7,8}$/.test(valor);
}

function EsCdiValido(valor: string): boolean {
  return /^[0-9]{11}$/.test(valor);
}

/**
 * Valida la consistencia entre condicionIva, tipoDocumento y nroDocumento.
 * Devuelve un mensaje de error legible, o null si los datos son consistentes.
 *
 * `nroDocumento` admite number | string | null/undefined. El 0 se trata como "sin documento"
 * (misma convención que usa ObjFacturar para Consumidor Final sin datos).
 */
export function ValidarConsistenciaFiscal(data: {
  condicionIva?: number | null;
  tipoDocumento?: number | null;
  nroDocumento?: number | string | null;
}): string | null {
  const condicionIva = data.condicionIva ?? undefined;
  const tipoDocumento = data.tipoDocumento ?? undefined;
  const nroDocumento = data.nroDocumento && data.nroDocumento !== 0 ? String(data.nroDocumento) : '';

  const exigeCuit = condicionIva != null && CONDICIONES_IVA_CUIT_OBLIGATORIO.includes(condicionIva);

  if (exigeCuit && tipoDocumento !== CUIT) {
    return 'Esta condición frente al IVA exige CUIT como tipo de documento.';
  }

  // Sin tipo de documento (o "Sin identificar"): válido solo si la condición IVA no exige CUIT
  if (!tipoDocumento || tipoDocumento === SIN_IDENTIFICAR) {
    return null;
  }

  if (!nroDocumento) {
    return 'Falta el número de documento.';
  }

  if ((tipoDocumento === CUIT || tipoDocumento === CUIL) && !EsCuitCuilValido(nroDocumento)) {
    return 'El CUIT/CUIL ingresado no es válido.';
  }

  if (tipoDocumento === DNI && !EsDniValido(nroDocumento)) {
    return 'El DNI ingresado no es válido.';
  }

  if (tipoDocumento === CDI && !EsCdiValido(nroDocumento)) {
    return 'El CDI ingresado no es válido.';
  }

  return null;
}
