// Mapeo de la respuesta de ws_sr_constancia_inscripcion (afip.registerInscriptionProofService)
// hacia una sugerencia editable de razonSocial/condicionIva para el alta de clientes.
//
// Decisión de diseño (validada con el usuario): el padrón de AFIP/ARCA no expone un campo
// "condición frente al IVA" 1:1 contra el catálogo local (CONDICIONES_IVA en
// datos-fiscales.constants.ts). Lo que sí expone es la lista de impuestos/regímenes en los
// que el contribuyente está inscripto, de donde se INFIERE la condición. Por eso esta función
// nunca debe tratarse como autoridad: el resultado es siempre una sugerencia editable, y
// ValidarConsistenciaFiscal (datosFiscales.ts) sigue siendo el guardrail final antes de persistir.
//
// Mapeo y nivel de confianza:
// - idImpuesto 30 (IVA) en datosRegimenGeneral.impuesto  → IVA Responsable Inscripto (1). Alta confianza:
//   el padrón lo declara explícitamente.
// - idImpuesto 20 (Monotributo) en datosMonotributo.impuesto, o categoriaMonotributo presente →
//   Responsable Monotributo (6). Alta confianza en que es monotributista; NO se distingue
//   "Monotributista Social" (13) de Monotributo común, porque no se identificó un campo confiable
//   para esa distinción en los manuales de ARCA disponibles. Se prioriza el caso mayoritario (6)
//   y se deja como ajuste manual si corresponde "Social" — el daño de una sugerencia editable
//   incorrecta en un caso minoritario es bajo, y queda visible vía el badge "sugerido".
// - Sin impuesto IVA ni Monotributo: no se puede distinguir Exento (4) de No Alcanzado (15) con
//   los datos disponibles → no se sugiere condicionIva (queda en null) y se devuelve una
//   advertencia para que el usuario la complete a mano.
const IMPUESTO_IVA = 30;
const IMPUESTO_MONOTRIBUTO = 20;

const CONDICION_IVA_RESPONSABLE_INSCRIPTO = 1;
const CONDICION_IVA_MONOTRIBUTO = 6;

export interface SugerenciaPadron {
  /** Razón social (persona jurídica) o "Apellido, Nombre" (persona física). Null si el padrón no trae ninguno de los dos. */
  razonSocial: string | null;
  /** Código local de CONDICIONES_IVA, o null si no se pudo determinar con confianza razonable. */
  condicionIva: number | null;
  /** 'alta': dato explícito en el padrón. 'sin_determinar': el campo debe completarse manualmente. */
  confianza: 'alta' | 'sin_determinar';
  /** Mensaje a mostrar al usuario cuando confianza es 'sin_determinar' o el CUIT está inactivo. */
  advertencia?: string;
  /** true si estadoClave del padrón es distinto de ACTIVO (CUIT dado de baja, suspendido, etc.). */
  cuitInactivo: boolean;
}

export function MapearSugerenciaPadron(personaReturn: any): SugerenciaPadron {
  const generales = personaReturn?.datosGenerales ?? {};
  const monotributo = personaReturn?.datosMonotributo;
  const regimenGeneral = personaReturn?.datosRegimenGeneral;

  const razonSocial = ObtenerRazonSocial(generales);
  const cuitInactivo = !!generales.estadoClave && generales.estadoClave !== 'ACTIVO';

  const tieneIva = (regimenGeneral?.impuesto ?? []).some((i: any) => i.idImpuesto === IMPUESTO_IVA);
  const tieneMonotributo =
    (monotributo?.impuesto ?? []).some((i: any) => i.idImpuesto === IMPUESTO_MONOTRIBUTO) ||
    !!monotributo?.categoriaMonotributo;

  let resultado: SugerenciaPadron;

  if (tieneIva) {
    resultado = {
      razonSocial,
      condicionIva: CONDICION_IVA_RESPONSABLE_INSCRIPTO,
      confianza: 'alta',
      cuitInactivo
    };
  } else if (tieneMonotributo) {
    resultado = {
      razonSocial,
      condicionIva: CONDICION_IVA_MONOTRIBUTO,
      confianza: 'alta',
      cuitInactivo
    };
  } else {
    resultado = {
      razonSocial,
      condicionIva: null,
      confianza: 'sin_determinar',
      advertencia: 'ARCA no registra inscripción en IVA ni Monotributo para este contribuyente. Verificá manualmente si corresponde Exento o No Alcanzado.',
      cuitInactivo
    };
  }

  if (cuitInactivo) {
    const avisoInactivo = `El CUIT figura como ${generales.estadoClave} en ARCA.`;
    resultado.advertencia = resultado.advertencia ? `${resultado.advertencia} ${avisoInactivo}` : avisoInactivo;
  }

  return resultado;
}

function ObtenerRazonSocial(generales: any): string | null {
  if (generales.razonSocial) return generales.razonSocial;

  if (generales.apellido || generales.nombre) {
    return [generales.apellido, generales.nombre].filter(Boolean).join(', ');
  }

  return null;
}
