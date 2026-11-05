import path from "path";
import PdfPrinter from 'pdfmake';
import { ParametrosRepo } from "../data/parametrosRepository";
import { FacturacionServ } from "./facturacionService";
import { Venta } from "../models/Venta";
import { Presupuesto } from "../models/Presupuesto";
import { DetallePresupuesto } from "../models/DetallePresupuesto";
import logger from "../logger/loggerGeneral";
import { rutaLogo } from "./logoService";
import { ventaMuestra, presupuestoMuestra, detallesPresupuestoMuestra, TOTAL_MUESTRA } from "./comprobanteMuestra";
const QRCode = require('qrcode');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTES Y LOOKUP TABLES
// ─────────────────────────────────────────────────────────────────────────────

const fonts = {
  Roboto: {
    normal:      path.join(__dirname, '../fonts/Roboto-Regular.ttf'),
    bold:        path.join(__dirname, '../fonts/Roboto-Medium.ttf'),
    italics:     path.join(__dirname, '../fonts/Roboto-Italic.ttf'),
    bolditalics: path.join(__dirname, '../fonts/Roboto-MediumItalic.ttf'),
  },
};

/**
 * Tipos de documento aceptados por AFIP para el receptor.
 * El id corresponde al código oficial del organismo — no modificar sin verificar.
 */
const TIPOS_DOCUMENTO = [
  { id: 80, descripcion: 'CUIT' },
  { id: 86, descripcion: 'CUIL' },
  { id: 96, descripcion: 'DNI'  },
  { id: 87, descripcion: 'CDI'  },
];

/**
 * Condiciones IVA del receptor según resolución AFIP.
 * Usado para mostrar la condición en texto en el comprobante.
 */
const CONDICIONES_IVA_RECEPTOR = [
  { id: 5,  descripcion: 'Consumidor Final'           },
  { id: 1,  descripcion: 'IVA Responsable Inscripto'  },
  { id: 6,  descripcion: 'Responsable Monotributo'    },
  { id: 13, descripcion: 'Monotributista Social'      },
  { id: 4,  descripcion: 'IVA Sujeto Exento'          },
  { id: 15, descripcion: 'IVA No Alcanzado'           },
];

/**
 * Código AFIP → letra visible en el comprobante (A, B, C).
 * 1/6/11 = Factura A/B/C. 3/8/13 = Nota de Crédito A/B/C (TipoComprobante en objFacturar.ts).
 */
const TIPO_COMPROBANTE_LETRA: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C', 3: 'A', 8: 'B', 13: 'C' };

// Mismos códigos que la mitad derecha del mapa de arriba — separados para poder anteponer
// "NC" a la letra en el recuadro impreso sin que la Factura (1/6/11) se vea afectada,
// ya que ambas comparten buildEncabezadoFactura en el térmico.
const TIPOS_NOTA_CREDITO = new Set([3, 8, 13]);

const printer = new PdfPrinter(fonts);

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/** Propiedades visuales y de layout para cada tamaño de papel soportado. */
interface ConfiguracionPapel {
  /** height 'auto' (térmicas): la página mide lo que mide el contenido — ver CONFIGURACIONES_PAPEL. */
  pageSize:     string | { width: number; height: number | 'auto' };
  fontSizes:    { titulo: number; normal: number; tabla: number; total: number };
  marginTop:    number;
  tableMargin:  number[];
  /** Máximo de caracteres por línea en la columna Producto. */
  maxChars:     number;
  /** Decimales para montos (1 en térmicas para ahorrar espacio, 2 en A4). */
  decimales:    number;
  /** Decimales para cantidades (0 en 58mm, 2 en A4). */
  cantDecimals: number;
  qrWidth:      number;
}

/**
 * Datos del comprobante normalizados para los builders.
 * Se construye en mapearComprobante() a partir de la venta y los parámetros del sistema.
 */
interface ComprobanteData {
  papel:            string;
  margenIzq:        number;
  margenDer:        number;
  nombreLocal:      string;
  descripcionLocal: string;
  direccionLocal:   string;
  fechaVenta:       string;
  horaVenta:        string | undefined;
  /** Filas de la tabla de productos, ya formateadas para pdfmake. */
  filasTabla:       unknown[][];
  /** Recuadro en blanco para que el cliente anote observaciones a mano. Solo aplica a tickets (no A4, ver buildObservaciones). Opcional: mapearComprobanteNotaCredito/mapearPresupuestoComprobante no lo setean porque esos documentos no lo usan. */
  mostrarObservaciones?: boolean;
  /** Título del recuadro de observaciones (editable: "Observaciones", "Firma", ...). */
  textoObservaciones?: string;
  /** Datos NO fiscales ya resueltos por resolverPersonalizacion(): vacío = no se imprime. */
  telefonoLocal?: string;
  mensajeExtra?: string;
  /** Path absoluto del logo, solo si está activo y el archivo existe (ver rutaLogo). */
  logoPath?: string;
  /** false solo cuando el usuario ocultó el nombre Y hay logo: sin logo el nombre siempre se imprime. */
  mostrarNombre?: boolean;
}

/**
 * Datos de factura AFIP listos para renderizar.
 * Se construye en mapearFactura() cruzando la venta con los parámetros de facturación.
 */
interface FacturaAFIP {
  puntoVenta:         number | undefined;
  ticket:             number | undefined;
  neto:               number | undefined;
  iva:                number | undefined;
  cae:                string | undefined;
  caeVto:             string;
  tipoComprobante:    number | undefined;
  desTipoComprobante: string;
  condicion:          string;
  razon:              string;
  direccion:          string;
  CUIL:               string;
  condicionReceptor:   string | undefined;
  /** Nombre/razón social a mostrar para el receptor — ya resuelto con fallback "Consumidor Final". */
  clienteReceptor:     string;
  /** Dirección del receptor — se muestra solo si existe (no todos los clientes la tienen). */
  direccionReceptor?:  string;
  DNI:                 number | undefined;
  tipoDNI:             string | undefined;
  qr:                  string;
}

/** Línea de detalle de una NC parcial — precio ya congelado de `ventas_detalle`. */
export interface DetalleNotaCredito {
  nomProd:  string;
  cantidad: number;
  precio:   number;
}

/**
 * Payload de impresión de una Nota de Crédito, resuelto enteramente por
 * NotaCreditoService.ObtenerImpresion() — tanto al emitir una NC nueva como al
 * reimprimir una ya emitida (mismo criterio que generarComprobantePDF recibe el Venta
 * completo desde el caller — esta función de PDF no vuelve a consultar la DB).
 */
export interface NotaCreditoImpresion {
  tipo:     number; // TipoComprobante NC_A=3 / NC_B=8 / NC_C=13 (objFacturar.ts)
  ticket:   number;
  ptoVenta: number;
  cae:      string;
  caeVto:   Date | string;
  neto:     number;
  iva:      number;
  total:    number;
  fecha:    Date | string;
  motivo?:  string | null;
  /** Vacío si la NC es total (sin detalle de línea, solo el monto global). */
  detalles: DetalleNotaCredito[];

  // Receptor — heredado de la factura original (misma venta, mismo cliente)
  dni?:            number;
  tipoDni?:        number;
  condReceptor?:   number;
  clienteReceptor: string;

  // Factura original contra la que se emite la NC (CbtesAsoc en AFIP)
  comprobanteAsociado: {
    tipo:     number;
    ptoVenta: number;
    ticket:   number;
  };

  /** Ya generado por FacturacionServ.GenerarQR() — esta función no llama a AFIP. */
  qr: string;
}

/** Resumen financiero de la venta, calculado por calcularResumenVenta(). */
interface ResumenVenta {
  subtotal:     number;
  total:        number;
  montoAjuste:  number;
  tipo:         'descuento' | 'recargo' | null;
  porcentaje:   number | null;
  entregado:    number;
  restante:     number;
  tieneDeuda:   boolean;
  totalMostrar: number;
}

/** Documentos que soporta la vista previa de configuración. */
export type TipoVistaPrevia = 'interno' | 'factura' | 'presupuesto';

/**
 * Parámetros del comprobante recibidos desde el caller (route → servicio).
 * Las propiedades con nombres legacy (desLocal, dirLocal, nomLocal) vienen de la DB
 * y se normalizan en mapearComprobante() — no renombrar aquí por costo de migración.
 */
interface ParametrosComprobante {
  papel:     string;
  margenIzq: number;
  margenDer: number;
  nomLocal:  string;
  desLocal:  string;
  dirLocal:  string;
  /** Preferencia de impresión (default true, ver migración parametros_impresion): agrega un recuadro en blanco al pie del ticket para anotaciones. No aplica a A4. */
  mostrarObservaciones?: boolean;
  /** Personalización (Preferencias > Impresión). Los mostrar* llegan como 0/1 desde mysql2. */
  textoObservaciones?: string | null;
  telefonoLocal?:      string | null;
  mensajeExtra?:       string | null;
  mostrarDireccion?:   boolean | number;
  mostrarTelefono?:    boolean | number;
  mostrarMensaje?:     boolean | number;
  /** Nombre de archivo del logo (no un path) y sus toggles. Ver services/logoService.ts. */
  logo?:               string | null;
  mostrarLogo?:        boolean | number;
  mostrarNombre?:      boolean | number;
}

/**
 * Datos de presupuesto normalizados para buildDocPresupuesto().
 * Un presupuesto no tiene pago/factura — es un documento simple sin valor fiscal.
 */
interface PresupuestoComprobante {
  numero:       number;
  validezHasta: string;
  cliente:      string | undefined;
  total:        number;
}

/**
 * mysql2 devuelve los tinyint(1) como 0/1, no como boolean: `valor !== false` daba siempre
 * true y un toggle apagado seguía imprimiendo. Solo 0/false/'0' cuentan como apagado; el
 * default (undefined/null, columna aún sin migrar) es encendido = comportamiento previo.
 */
function activo(valor: unknown): boolean {
  return !(valor === false || valor === 0 || valor === '0');
}

/**
 * Resuelve los datos NO fiscales personalizables del local aplicando los toggles: un dato
 * apagado o vacío queda en '' y los builders solo chequean truthiness. Nunca afecta al
 * domicilio fiscal de las facturas (sale de parametros_facturacion, no de acá).
 */
function resolverPersonalizacion(parametros: ParametrosComprobante) {
  const visible = (mostrar: unknown, valor?: string | null) =>
    activo(mostrar) ? (valor ?? '').trim() : '';

  const logoPath = activo(parametros.mostrarLogo) ? rutaLogo(parametros.logo) : undefined;

  return {
    // Ocultar el nombre solo tiene sentido si el logo realmente se va a imprimir; si no, el
    // comprobante quedaría sin identificar al local.
    logoPath,
    mostrarNombre:      activo(parametros.mostrarNombre) || !logoPath,
    direccionLocal:     visible(parametros.mostrarDireccion, parametros.dirLocal),
    telefonoLocal:      visible(parametros.mostrarTelefono,  parametros.telefonoLocal),
    mensajeExtra:       visible(parametros.mostrarMensaje,   parametros.mensajeExtra),
    textoObservaciones: parametros.textoObservaciones?.trim() || 'Observaciones',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN POR PAPEL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Layout visual para cada tamaño de papel soportado.
 * Para agregar un nuevo formato, basta con registrarlo aquí — los builders lo consumen
 * por nombre sin cambios adicionales.
 */
const CONFIGURACIONES_PAPEL: Record<string, ConfiguracionPapel> = {
  '58mm': {
    // height 'auto': un ticket es un rollo continuo. Con alto fijo (800pt ≈ 28cm) una venta larga
    // se partía en 2 páginas (2 cortes) y una corta arrastraba papel en blanco.
    pageSize:     { width: 140, height: 'auto' },
    fontSizes:    { titulo: 11, normal: 7, tabla: 6.5, total: 9 },
    marginTop:    1,
    tableMargin:  [0, 3, 0, 2],
    maxChars:     25,   // espacio muy limitado: sin truncado los nombres largos rompen el layout de tabla
    decimales:    1,    // 1 decimal ahorra espacio horizontal en ticket angosto
    cantDecimals: 0,    // entero ("2" en vez de "2.00") porque la columna C es muy estrecha
    qrWidth:      100,
  },

  '80mm': {
    pageSize:     { width: 200, height: 'auto' },
    fontSizes:    { titulo: 14, normal: 10, tabla: 8.5, total: 12 },
    marginTop:    2,
    tableMargin:  [0, 4, 0, 2],
    maxChars:     35,
    decimales:    1,
    cantDecimals: 1,
    qrWidth:      120,
  },

  'A4': {
    pageSize:     'A4',
    fontSizes:    { titulo: 16, normal: 12, tabla: 11, total: 15 },
    marginTop:    10,
    tableMargin:  [0, 10, 0, 10],
    maxChars:     999,  // sin límite: pdfmake hace el salto de línea automáticamente
    decimales:    2,
    cantDecimals: 2,
    qrWidth:      150,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS DE FORMATO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formatea un número como moneda argentina (es-AR).
 * La cantidad de decimales varía por papel para ahorrar espacio en tickets.
 */
function formatearMoneda(valor: number, configuracionPapel: ConfiguracionPapel): string {
  return valor.toLocaleString('es-AR', {
    minimumFractionDigits: configuracionPapel.decimales,
    maximumFractionDigits: configuracionPapel.decimales,
  });
}

/**
 * Formatea una cantidad respetando la precisión por papel.
 * En 58mm muestra entero ("3"), en A4 con decimales ("3.00").
 */
function formatearCantidad(valor: number, configuracionPapel: ConfiguracionPapel): string {
  return Number(valor).toLocaleString('es-AR', {
    minimumFractionDigits: configuracionPapel.cantDecimals,
    maximumFractionDigits: configuracionPapel.cantDecimals,
  });
}

/**
 * Corta texto al límite de caracteres del papel respetando palabras completas.
 *
 * En 58mm el límite es 25 chars. Sin truncado, los nombres de producto largos
 * rompen el layout horizontal de la tabla porque pdfmake no hace overflow en
 * celdas con ancho 'auto'.
 */
function truncarTexto(texto: string, configuracionPapel: ConfiguracionPapel): string {
  if (!texto) return '';
  const max = configuracionPapel.maxChars;
  if (texto.length <= max) return texto;

  let resultado = '';
  for (const palabra of texto.split(' ')) {
    const tentativa = resultado ? `${resultado} ${palabra}` : palabra;
    if (tentativa.length <= max) {
      resultado = tentativa;
    } else {
      break;
    }
  }

  // Una sola palabra ya supera el límite — cortar con elipsis como fallback
  if (!resultado) return texto.substring(0, max - 1) + '…';

  return resultado + '…';
}

/** Convierte un valor a nodo celda de pdfmake, combinando con opciones adicionales. */
function celda(texto: string | number, opciones: Record<string, unknown> = {}): object {
  return { text: String(texto ?? ''), ...opciones };
}

/**
 * Nodo pdfmake alineado a la derecha, usado en la sección de totales.
 * `tipo` aplica estilos semánticos: verde para descuento, rojo para recargo,
 * negrita grande para total.
 */
function filaAlineadaDerecha(
  texto: string,
  configuracionPapel: ConfiguracionPapel,
  tipo?: 'total' | 'descuento' | 'recargo' | 'deuda',
): object {
  const estilos: Record<string, Record<string, unknown>> = {
    total:     { bold: true, fontSize: configuracionPapel.fontSizes.total },
    descuento: { color: 'green' },
    recargo:   { color: 'red' },
    deuda:     { bold: true },
  };

  return {
    text:      texto,
    alignment: 'right',
    margin:    [0, 1, 0, 1],
    fontSize:  configuracionPapel.fontSizes.normal,
    ...(tipo ? estilos[tipo] : {}),
  };
}

/** Nodo pdfmake "Label: valor" en línea. Reutilizado en encabezados y datos de receptor A4. */
function labelValor(label: string, valor: string | number | null | undefined, negrita = false): object {
  return {
    text: [
      { text: `${label}: `, bold: true },
      { text: String(valor ?? '—'), bold: negrita },
    ],
    fontSize: 10,
    margin: [8, 0, 0, 4],
  };
}

/**
 * Layout de líneas gris claro para tablas A4.
 * Extraído como función porque pdfmake no acepta el objeto layout reutilizado por referencia.
 */
function layoutLineas(): object {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#aaaaaa',
    vLineColor: () => '#aaaaaa',
  };
}

/**
 * Texto resumen de métodos de pago para la sección del receptor.
 * Soporta pago combinado: "Efectivo: $500  |  Débito: $300".
 */
function formatearTextoPago(venta: Venta): string {
  if (!venta.detallePago?.length) return '—';
  return venta.detallePago
    .map(d => `${d.tipoPago.nombre}: $${d.monto.toLocaleString('es-AR')}`)
    .join('  |  ');
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDERS DE SECCIÓN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caja máxima [ancho, alto] del logo por papel, en pt. `fit` escala manteniendo la proporción: un
 * logo vertical no se estira al ancho y no ocupa medio ticket. Fija a propósito: un selector de
 * tamaño se agrega si un comercio lo pide.
 */
const CAJA_LOGO: Record<string, [number, number]> = { '58mm': [90, 55], '80mm': [130, 75], 'A4': [110, 70] };

/**
 * Logo del local centrado, listo para esparcir en `content`/`stack` (vacío si no hay logo activo).
 * Todos los encabezados lo usan: buildEncabezado (térmicas, interno y presupuesto A4) y las
 * columnas del emisor de factura A4 y NC A4.
 */
function buildLogo(comprobante: ComprobanteData): object[] {
  if (!comprobante.logoPath) return [];
  return [{
    image:     comprobante.logoPath,
    fit:       CAJA_LOGO[comprobante.papel] ?? CAJA_LOGO['80mm'],
    alignment: 'center',
    margin:    [0, 2, 0, 4],
  }];
}

/**
 * Encabezado del comprobante: nombre del local, descripción, dirección y fecha.
 *
 * A4 usa dos columnas (nombre izquierda | fecha derecha).
 * Térmicas usan bloques centrados apilados para aprovechar el ancho limitado verticalmente.
 */
function buildEncabezado(
  comprobante: ComprobanteData,
  configuracionPapel: ConfiguracionPapel,
  esFactura = false,
  documento?: { titulo: string; numero?: string | number },
): object {
  if (comprobante.papel === 'A4') {
    // Mismo esquema que el encabezado de factura A4 (emisor | documento), sin datos fiscales.
    return {
      table: {
        widths: ['55%', '45%'],
        body: [[
          {
            stack: [
              ...buildLogo(comprobante),
              ...(comprobante.mostrarNombre !== false
                ? [{ text: comprobante.nombreLocal?.toUpperCase(), fontSize: 14, bold: true, alignment: 'center', margin: [0, 6, 0, 8] }]
                : []),
              ...(comprobante.direccionLocal?.trim() ? [labelValor('Dirección', comprobante.direccionLocal)] : []),
              ...(comprobante.telefonoLocal?.trim() ? [labelValor('Teléfono', comprobante.telefonoLocal)] : []),
            ],
          },
          {
            stack: [
              { text: documento?.titulo ?? 'COMPROBANTE', fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
              ...(documento?.numero ? [labelValor('Nro', documento.numero, true)] : []),
              labelValor('Fecha', [comprobante.fechaVenta, comprobante.horaVenta].filter(Boolean).join(' - ')),
            ],
          },
        ]],
      },
      layout: layoutLineas(),
      margin: [0, 0, 0, 6],
    };
  }

  const filas = [
    ...buildLogo(comprobante),

    comprobante.mostrarNombre !== false
      ? { text: comprobante.nombreLocal?.toUpperCase(), alignment: 'center', fontSize: configuracionPapel.fontSizes.titulo, bold: true }
      : null,

    comprobante.descripcionLocal?.trim()
      ? { text: comprobante.descripcionLocal, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal }
      : null,

    // En facturas AFIP la dirección ya aparece en el bloque del emisor — no duplicar
    (!esFactura && comprobante.direccionLocal?.trim())
      ? { text: comprobante.direccionLocal, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal }
      : null,

    // El teléfono no es dato fiscal ni aparece en otro bloque: se muestra también en facturas/NC
    comprobante.telefonoLocal?.trim()
      ? { text: `Tel: ${comprobante.telefonoLocal}`, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal }
      : null,

    {
      text:      `${comprobante.fechaVenta} ${comprobante.horaVenta}`,
      alignment: 'center',
      fontSize:  configuracionPapel.fontSizes.normal,
      margin:    [0, configuracionPapel.marginTop, 0, configuracionPapel.marginTop],
    },
  ];

  return filas.filter(Boolean);
}

/**
 * Línea divisoria entre el encabezado y el cuerpo del comprobante interno/presupuesto (la factura
 * ya tiene la suya en buildEncabezadoFactura). El ancho se calcula desde el papel y los márgenes
 * reales —la de la factura usa 515 fijo, que solo tiene sentido en A4— para que sea igual en
 * 58mm, 80mm y A4. Los márgenes replican los de buildDocInterno/buildDocPresupuesto.
 */
function buildSeparador(comprobante: ComprobanteData, configuracionPapel: ConfiguracionPapel): object {
  const esA4          = comprobante.papel === 'A4';
  const anchoPagina   = typeof configuracionPapel.pageSize === 'string' ? 595.28 : configuracionPapel.pageSize.width;
  const margenIzq     = esA4 ? (comprobante.margenIzq || 15) : comprobante.margenIzq;
  const margenDer     = esA4 ? (comprobante.margenDer || 15) : comprobante.margenDer;

  return {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: anchoPagina - margenIzq - margenDer, y2: 0, lineWidth: 0.5 }],
    margin: [0, 3, 0, 3],
  };
}

/**
 * Nombre del cliente y métodos de pago utilizados.
 * Omite la línea de cliente si no existe o viene vacío (ej: venta sin cliente asignado).
 */
function buildClienteYPago(venta: Venta, configuracionPapel: ConfiguracionPapel): object[] {
  const filas: object[] = [];

  if (venta.cliente?.nombre?.trim()) {
    filas.push({
      text:     `Cliente: ${venta.cliente.nombre}`,
      fontSize: configuracionPapel.fontSizes.normal,
      margin:   [0, 2, 0, 0],
    });
  }

  // Lista de precios aplicada (handoff_multiprecio_venta_sonnet, Fase 4). Se omite cuando es
  // Minorista (el caso normal) para no ensuciar el ticket; solo interesa dejar constancia
  // cuando se vendió con una lista distinta. Esta función no se usa en buildDocFactura ni
  // buildDocFacturaA4, así que la factura AFIP nunca muestra esta línea (a propósito).
  if (venta.nombreLista && venta.nombreLista !== 'Minorista') {
    filas.push({
      text:     `Lista: ${venta.nombreLista}`,
      fontSize: configuracionPapel.fontSizes.normal,
      margin:   [0, 0, 0, 0],
    });
  }

  // Pago combinado: puede haber más de un método en una misma venta
  if (venta.detallePago?.length) {
    const pagos = venta.detallePago
      .map(d => `${d.tipoPago.nombre}: $${formatearMoneda(d.monto, configuracionPapel)}`)
      .join('  |  ');

    filas.push({
      text:     `Pago: ${pagos}`,
      fontSize: configuracionPapel.fontSizes.normal,
      margin:   [0, 0, 0, 2],
    });
  }

  return filas;
}

/**
 * Encabezado de factura AFIP para impresión térmica (58mm / 80mm).
 * El A4 tiene su propio layout en buildDocFacturaA4 con tres columnas.
 *
 * Estructura térmica: letra comprobante → datos emisor → número → datos receptor.
 */
function buildEncabezadoFactura(
  comprobante: ComprobanteData,
  factura: FacturaAFIP,
  configuracionPapel: ConfiguracionPapel,
): object[] {
  const filas: object[] = [];
  const letraComprobante = TIPO_COMPROBANTE_LETRA[factura.tipoComprobante ?? 0] ?? 'X';
  // Ancho 'auto': anteponer "NC " no requiere ajustar tamaños, la caja simplemente crece.
  const textoLetra = TIPOS_NOTA_CREDITO.has(factura.tipoComprobante ?? 0) ? `NC ${letraComprobante}` : letraComprobante;

  // Letra del comprobante en recuadro centrado — AFIP lo requiere visible y destacado
  filas.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: {
          body: [[{
            stack: [
              { text: textoLetra, alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.titulo + 4 },
              { text: `Cod:${factura.tipoComprobante}`, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 2 },
            ],
            margin: [5, 0, 5, 0],
          }]],
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5 },
      },
      { width: '*', text: '' },
    ],
    margin: [0, 0, 0, 5],
  });

  // Nombre del local y fecha (reutiliza buildEncabezado con flag esFactura para omitir dirección)
  filas.push(buildEncabezado(comprobante, configuracionPapel, true));

  // Separador + condición IVA + CUIL del emisor
  filas.push(
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }], margin: [0, 3, 0, 3] },
    { text: factura.condicion, alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.normal, margin: [0, 3, 0, 0] },
    { text: `${factura.CUIL}`, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal },
  );

  if (factura.razon?.trim()) {
    filas.push({ text: factura.razon, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 1 });
  }
  if (factura.direccion?.trim()) {
    filas.push({ text: factura.direccion, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 1, margin: [0, 0, 0, 2] });
  }

  // AFIP exige formato XXXX-XXXXXXXX (4 dígitos punto de venta + 8 dígitos ticket)
  filas.push(
    {
      text:      `Ticket Nro: ${String(factura.puntoVenta).padStart(4, '0')}-${String(factura.ticket).padStart(8, '0')}`,
      alignment: 'center',
      bold:      true,
      fontSize:  configuracionPapel.fontSizes.normal,
      margin:    [0, 0, 0, 2],
    },
    { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }], margin: [0, 3, 0, 3] },
  );

  // Datos del receptor — nombre/razón social siempre se muestra (fallback "Consumidor Final"
  // ya resuelto en factura.clienteReceptor). DNI/condición debajo, salvo que sea una repetición
  // exacta del nombre (ej: consumidor final sin DNI, donde condición también es "Consumidor Final").
  const dniTexto = factura.DNI ? `${factura.tipoDNI}: ${factura.DNI}` : '';
  const receptor = [dniTexto, factura.condicionReceptor].filter(Boolean).join('  |  ');
  const receptorEsRedundante = receptor === factura.clienteReceptor;

  const tieneLineaExtra = (receptor && !receptorEsRedundante) || !!factura.direccionReceptor;

  filas.push(
    { text: 'Receptor',              alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.normal - 1 },
    { text: factura.clienteReceptor, alignment: 'center',             fontSize: configuracionPapel.fontSizes.normal - 1, margin: tieneLineaExtra ? [0, 0, 0, 0] : [0, 0, 0, 2] },
  );
  if (receptor && !receptorEsRedundante) {
    filas.push(
      { text: receptor, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 1, margin: factura.direccionReceptor ? [0, 0, 0, 0] : [0, 0, 0, 2] },
    );
  }
  if (factura.direccionReceptor) {
    filas.push(
      { text: factura.direccionReceptor, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 1, margin: [0, 0, 0, 2] },
    );
  }

  return filas;
}

/**
 * Tabla de productos: C (cantidad) | Producto | P.Unit | Total.
 * Las filas de detalle se reciben pre-construidas desde mapearComprobante()
 * para mantener separada la responsabilidad de formateo de datos y estructura de tabla.
 */
function buildTabla(comprobante: ComprobanteData, configuracionPapel: ConfiguracionPapel): object {
  const encabezado = [
    celda('C',        { style: 'th' }),
    celda('Producto', { style: 'th' }),
    celda('P.Unit',   { style: 'th', alignment: 'right' }),
    celda('Total',    { style: 'th', alignment: 'right' }),
  ];

  const body: unknown[][] = [encabezado, ...comprobante.filasTabla];

  return {
    table: {
      widths: ['auto', '*', 'auto', 'auto'],
      body,
    },
    layout: {
      // Solo mostrar línea divisoria debajo del header y al final — no entre filas de productos
      fillColor:     (row: number) => (row === 0 ? '#eeeeee' : null),
      hLineWidth:    (i: number, node: any) => (i === 1 || i === node.table.body.length) ? 0.5 : 0,
      vLineWidth:    () => 0,
      paddingTop:    () => 1,
      paddingBottom: () => 1,
    },
    margin:     configuracionPapel.tableMargin,
    fontSize:   configuracionPapel.fontSizes.tabla,
    lineHeight: 1,
  };
}

/**
 * Construye las filas de detalle de productos para inyectar en buildTabla().
 * Separado de buildTabla para que cada función tenga una sola responsabilidad.
 */
function buildFilasDetalle(venta: Venta, configuracionPapel: ConfiguracionPapel): unknown[][] {
  return venta.detalles.map(item => [
    celda(formatearCantidad(item.cantidad ?? 0, configuracionPapel), { alignment: 'center' }),
    celda(truncarTexto(item.nomProd ?? '',      configuracionPapel)),
    celda(formatearMoneda(item.precio   ?? 0,  configuracionPapel), { alignment: 'right' }),
    celda(formatearMoneda(item.total    ?? 0,  configuracionPapel), { alignment: 'right' }),
  ]);
}

/**
 * Análoga a buildFilasDetalle() pero para detalles de presupuesto.
 * Misma forma de fila (cantidad/producto/precio/total) — se duplica en vez de forzar
 * que buildFilasDetalle() acepte Venta | Presupuesto, evitando acoplar el tipo Venta
 * a un documento que no tiene pago/factura.
 */
function buildFilasDetallePresupuesto(detalles: DetallePresupuesto[], configuracionPapel: ConfiguracionPapel): unknown[][] {
  return detalles.map(item => [
    celda(formatearCantidad(item.cantidad ?? 0, configuracionPapel), { alignment: 'center' }),
    celda(truncarTexto(item.nomProd ?? '',      configuracionPapel)),
    celda(formatearMoneda(item.precio   ?? 0,  configuracionPapel), { alignment: 'right' }),
    celda(formatearMoneda(item.total    ?? 0,  configuracionPapel), { alignment: 'right' }),
  ]);
}

/**
 * Análoga a buildFilasDetalle() pero para detalle de NC parcial. Misma forma de fila
 * — se duplica en vez de forzar Venta | NotaCreditoImpresion, mismo criterio que
 * buildFilasDetallePresupuesto (ver comentario arriba).
 */
function buildFilasDetalleNotaCredito(detalles: DetalleNotaCredito[], configuracionPapel: ConfiguracionPapel): unknown[][] {
  return detalles.map(item => [
    celda(formatearCantidad(item.cantidad ?? 0, configuracionPapel), { alignment: 'center' }),
    celda(truncarTexto(item.nomProd ?? '',      configuracionPapel)),
    celda(formatearMoneda(item.precio ?? 0,     configuracionPapel), { alignment: 'right' }),
    celda(formatearMoneda((item.cantidad ?? 0) * (item.precio ?? 0), configuracionPapel), { alignment: 'right' }),
  ]);
}

/**
 * Línea "Asociada a Factura X Nº PPPP-TTTTTTTT" — trazabilidad de la NC contra el
 * comprobante que cancela/ajusta. No tiene equivalente en buildEncabezadoFactura
 * porque ese builder es compartido con facturas normales, que no tienen asociado.
 */
function buildComprobanteAsociado(
  asociado: { tipo: number; ptoVenta: number; ticket: number },
  configuracionPapel: ConfiguracionPapel,
): object {
  const letra = TIPO_COMPROBANTE_LETRA[asociado.tipo] ?? 'X';
  return {
    text:      `Asociada a Factura ${letra} Nº ${String(asociado.ptoVenta).padStart(4, '0')}-${String(asociado.ticket).padStart(8, '0')}`,
    alignment: 'center',
    bold:      true,
    fontSize:  configuracionPapel.fontSizes.normal,
    margin:    [0, 0, 0, 3],
  };
}

/**
 * Total de una NC: a diferencia de buildTotales(), no hay subtotal/ajuste/deuda —
 * una NC no tiene descuento, recargo ni pago propio (ver restricción de NC parcial
 * en el plan: solo se habilita sobre ventas sin descuento/recargo).
 */
function buildTotalNotaCredito(total: number, configuracionPapel: ConfiguracionPapel): object {
  return filaAlineadaDerecha(`TOTAL: $${formatearMoneda(total, configuracionPapel)}`, configuracionPapel, 'total');
}

/**
 * Bloque de totales: subtotal → ajuste (descuento/recargo) → TOTAL → deuda.
 * Solo renderiza las filas que aplican; si no hay modificador, omite subtotal y ajuste.
 */
function buildTotales(resumen: ResumenVenta | null, configuracionPapel: ConfiguracionPapel): object[] {
  if (!resumen) return [];

  const filas: object[] = [];

  const tieneModificador = resumen.montoAjuste > 0;
  if (tieneModificador) {
    filas.push(filaAlineadaDerecha(`Subtotal: $${formatearMoneda(resumen.subtotal, configuracionPapel)}`, configuracionPapel));

    const esDescuento = resumen.tipo === 'descuento';
    const signo       = esDescuento ? '-' : '+';
    const label       = esDescuento ? 'Descuento' : 'Recargo';
    const porcentaje  = resumen.porcentaje ? ` (${resumen.porcentaje.toFixed(2)}%)` : '';

    filas.push(filaAlineadaDerecha(
      `${label}${porcentaje}: ${signo}$${formatearMoneda(resumen.montoAjuste, configuracionPapel)}`,
      configuracionPapel,
      resumen.tipo ?? undefined,
    ));
  }

  filas.push(filaAlineadaDerecha(`TOTAL: $${formatearMoneda(resumen.total, configuracionPapel)}`, configuracionPapel, 'total'));

  // Deuda: solo si el cliente entregó menos del total (pago parcial / cuenta corriente)
  if (resumen.tieneDeuda) {
    filas.push(
      filaAlineadaDerecha(`Entregado: $${formatearMoneda(resumen.entregado, configuracionPapel)}`, configuracionPapel),
      filaAlineadaDerecha(`Debe:      $${formatearMoneda(resumen.restante,  configuracionPapel)}`, configuracionPapel, 'deuda'),
    );
  }

  return filas;
}

/**
 * Desglose de IVA — solo para facturas tipo A y B.
 * Tipo C (monotributo) no discrimina IVA según normativa AFIP.
 */
function buildIVA(factura: FacturaAFIP, configuracionPapel: ConfiguracionPapel): object[] {
  if (factura.tipoComprobante === 11) return [];

  const esA4 = configuracionPapel.pageSize === 'A4';

  return [
    { text: 'IVA 21% Incluido', alignment: esA4 ? 'right' : 'center', margin: [0, 5, 0, 3], fontSize: configuracionPapel.fontSizes.normal },
    filaAlineadaDerecha(`NETO: $${formatearMoneda(factura.neto ?? 0, configuracionPapel)}`, configuracionPapel),
    filaAlineadaDerecha(`IVA:  $${formatearMoneda(factura.iva  ?? 0, configuracionPapel)}`, configuracionPapel),
  ];
}

/** Bloque del CAE (código de autorización electrónica) emitido por AFIP. */
function buildCAE(factura: FacturaAFIP, configuracionPapel: ConfiguracionPapel): object {
  return {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'CAE',          alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.normal },
          { text: factura.cae,    alignment: 'center',             fontSize: configuracionPapel.fontSizes.normal },
          { text: factura.caeVto, alignment: 'center',             fontSize: configuracionPapel.fontSizes.normal },
        ],
      }]],
    },
    layout: 'noBorders',
    margin: [0, 3, 0, 3],
  };
}

/** QR de verificación AFIP. El contenido del QR se genera en FacturacionServ.ObtenerQRFactura(). */
function buildQR(factura: FacturaAFIP, configuracionPapel: ConfiguracionPapel): object {
  return {
    image:     factura.qr,
    width:     configuracionPapel.qrWidth,
    alignment: 'center',
  };
}

/**
 * Recuadro en blanco al pie del ticket para que el cliente anote observaciones a mano
 * (pedido explícito: "un lugarcito, cuadradito, para escribir cosas"). Ancho completo del
 * área de contenido vía widths:['*'] (mismo patrón que buildCAE) para no depender del
 * tamaño de papel; alto fijo, suficiente para un par de líneas manuscritas.
 * Preferencia "Impresión > Mostrar observaciones" en parametros_impresion (default true) —
 * ver mapearComprobante(). Nunca se llama para A4 (gateado en el caller).
 */
function buildObservaciones(configuracionPapel: ConfiguracionPapel, titulo = 'Observaciones'): object {
  return {
    stack: [
      { text: titulo, fontSize: configuracionPapel.fontSizes.normal, bold: true, margin: [0, 6, 0, 2] },
      {
        table: {
          widths: ['*'],
          heights: [50],
          body: [['']],
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#000000',
          vLineColor: () => '#000000',
        },
      },
    ],
  };
}

/**
 * Mensaje libre al pie ("Gracias por su compra"). Devuelve un array para poder esparcirlo en
 * `content` sin nulls: vacío si el local no configuró mensaje o lo apagó. No se usa en NC.
 */
function buildMensajeExtra(comprobante: ComprobanteData, configuracionPapel: ConfiguracionPapel): object[] {
  if (!comprobante.mensajeExtra?.trim()) return [];
  return [{
    text:      comprobante.mensajeExtra,
    alignment: 'center',
    fontSize:  configuracionPapel.fontSizes.normal,
    margin:    [0, 6, 0, 0],
  }];
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILDERS DE DOCUMENTO COMPLETO
// ─────────────────────────────────────────────────────────────────────────────

function buildDocInterno(comprobante: ComprobanteData, resumen: ResumenVenta | null, venta: Venta): object {
  const configuracionPapel = obtenerConfiguracionPapel(comprobante.papel);

  return {
    pageSize: configuracionPapel.pageSize,
    pageMargins: comprobante.papel === 'A4'
      ? [comprobante.margenIzq || 15, 15, comprobante.margenDer || 15, 15]
      : [comprobante.margenIzq, 4, comprobante.margenDer, 4],

    content: [
      buildEncabezado(comprobante, configuracionPapel, false, { titulo: 'COMPROBANTE' }),
      ...(comprobante.papel === 'A4' ? [] : [buildSeparador(comprobante, configuracionPapel)]),
      ...buildClienteYPago(venta, configuracionPapel),
      buildTabla(comprobante, configuracionPapel),
      ...buildTotales(resumen, configuracionPapel),
      ...buildMensajeExtra(comprobante, configuracionPapel),
      ...(comprobante.papel !== 'A4' && comprobante.mostrarObservaciones ? [buildObservaciones(configuracionPapel, comprobante.textoObservaciones)] : []),
    ],
  };
}

/**
 * Documento de presupuesto: encabezado del local + datos del presupuesto
 * (número, cliente, validez) + tabla de productos + total + leyenda de "no fiscal".
 *
 * No reutiliza buildDocInterno() porque ese flujo depende de Venta (cliente vía
 * venta.cliente, totales vía calcularResumenVenta basado en pago) — un presupuesto
 * no tiene pago ni descuento/recargo/deuda, solo un total fijo.
 */
function buildDocPresupuesto(comprobante: ComprobanteData, presupuesto: PresupuestoComprobante): object {
  const configuracionPapel = obtenerConfiguracionPapel(comprobante.papel);
  const alineacion = comprobante.papel === 'A4' ? 'left' : 'center';

  return {
    pageSize: configuracionPapel.pageSize,
    pageMargins: comprobante.papel === 'A4'
      ? [comprobante.margenIzq || 15, 15, comprobante.margenDer || 15, 15]
      : [comprobante.margenIzq, 4, comprobante.margenDer, 4],

    content: [
      buildEncabezado(comprobante, configuracionPapel, false, { titulo: 'PRESUPUESTO', numero: presupuesto.numero }),
      ...(comprobante.papel === 'A4' ? [] : [buildSeparador(comprobante, configuracionPapel)]),
      // En A4 el número ya va en el encabezado
      comprobante.papel === 'A4' ? null : {
        text:      `Presupuesto N° ${presupuesto.numero}`,
        alignment: alineacion,
        bold:      true,
        fontSize:  configuracionPapel.fontSizes.normal,
        margin:    [0, 2, 0, 0],
      },
      presupuesto.cliente
        ? { text: `Cliente: ${presupuesto.cliente}`, fontSize: configuracionPapel.fontSizes.normal, margin: [0, 2, 0, 0] }
        : null,
      {
        text:     `Válido hasta: ${presupuesto.validezHasta}`,
        fontSize: configuracionPapel.fontSizes.normal,
        margin:   [0, 0, 0, 2],
      },
      buildTabla(comprobante, configuracionPapel),
      filaAlineadaDerecha(`TOTAL: $${formatearMoneda(presupuesto.total, configuracionPapel)}`, configuracionPapel, 'total'),
      ...buildMensajeExtra(comprobante, configuracionPapel),
      {
        text:      'Este documento es un presupuesto sin valor fiscal. Los precios pueden variar según disponibilidad.',
        italics:   true,
        alignment: alineacion,
        fontSize:  Math.max(configuracionPapel.fontSizes.normal - 2, 6),
        margin:    [0, 6, 0, 0],
      },
    ].filter(Boolean),
  };
}

/**
 * Dispatcher de factura: delega a A4 o a la versión térmica según el papel configurado.
 * El layout A4 es sustancialmente diferente (3 columnas, tabla receptor, pie con QR+CAE).
 */
function buildDocFactura(
  comprobante: ComprobanteData,
  resumen: ResumenVenta | null,
  venta: Venta,
  factura: FacturaAFIP,
): object {
  const configuracionPapel = obtenerConfiguracionPapel(comprobante.papel);
  if (comprobante.papel === 'A4') {
    return buildDocFacturaA4(comprobante, resumen, venta, factura);
  }

  // Layout compacto para tickets térmicos
  return {
    pageSize:    configuracionPapel.pageSize,
    pageMargins: [comprobante.margenIzq, 4, comprobante.margenDer, 4],
    content: [
      ...buildEncabezadoFactura(comprobante, factura, configuracionPapel),
      buildTabla(comprobante, configuracionPapel),
      ...buildTotales(resumen, configuracionPapel),
      ...buildIVA(factura, configuracionPapel),
      buildCAE(factura, configuracionPapel),
      buildQR(factura, configuracionPapel),
      ...buildMensajeExtra(comprobante, configuracionPapel),
      ...(comprobante.mostrarObservaciones ? [buildObservaciones(configuracionPapel, comprobante.textoObservaciones)] : []),
    ],
  };
}

/**
 * Layout profesional para factura A4.
 *
 * Estructura del documento:
 *   1. Header tres columnas: datos emisor | letra comprobante | datos del documento
 *   2. Tabla datos del receptor
 *   3. Tabla de productos
 *   4. Tabla de totales (izq: espacio para leyenda fiscal; der: números)
 *   5. Pie: QR + datos CAE
 */
function buildDocFacturaA4(
  comprobante: ComprobanteData,
  resumen: ResumenVenta | null,
  venta: Venta,
  factura: FacturaAFIP,
): object {
  const configuracionPapel = obtenerConfiguracionPapel('A4');
  const letraComprobante   = TIPO_COMPROBANTE_LETRA[factura.tipoComprobante ?? 0] ?? 'X';

  // ── 1. Header tres columnas ───────────────────────────────────────────────
  const headerTable = {
    table: {
      widths: ['45%', '10%', '45%'],
      body: [[
        // Columna izquierda — identificación del emisor
        {
          stack: [
            ...buildLogo(comprobante),
            ...(comprobante.mostrarNombre !== false
              ? [{ text: comprobante.nombreLocal?.toUpperCase(), fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] }]
              : []),
            labelValor('Dirección',    factura.direccion),
            ...(comprobante.telefonoLocal ? [labelValor('Teléfono', comprobante.telefonoLocal)] : []),
            labelValor('Cond. IVA',   factura.condicion),
            labelValor('CUIT',        factura.CUIL),
            labelValor('Razón Social', factura.razon),
          ],
        },
        // Columna central — letra del comprobante en grande (requisito visual AFIP)
        {
          stack: [
            { text: letraComprobante, fontSize: 25, bold: true, decoration: 'underline', alignment: 'center', margin: [0, 10, 0, 3] },
            { text: `Cod. ${factura.tipoComprobante}`, fontSize: 7, alignment: 'center' },
          ],
          alignment: 'center',
        },
        // Columna derecha — identificación del documento
        {
          stack: [
            { text: 'FACTURA', fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
            labelValor('Nro Comp',      `${factura.puntoVenta?.toString().padStart(4, '0')} - ${factura.ticket?.toString().padStart(8, '0')}`, true),
            labelValor('Fecha Emisión', `${comprobante.fechaVenta} - ${comprobante.horaVenta}`),
          ],
        },
      ]],
    },
    layout: layoutLineas(),
  };

  // ── 2. Datos del receptor ─────────────────────────────────────────────────
  // "Condición" se omite cuando coincide textualmente con "Cliente" (ej: consumidor
  // final sin nombre cargado, donde ambos valen "Consumidor Final") — mismo criterio
  // de deduplicación que usa buildEncabezadoFactura para el layout térmico.
  const condicionReceptorEsRedundante = factura.condicionReceptor === factura.clienteReceptor;

  const tablaReceptor = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          labelValor('Cliente', factura.clienteReceptor),
          ...(condicionReceptorEsRedundante ? [] : [labelValor('Condición', factura.condicionReceptor)]),
          ...(factura.DNI ? [labelValor(factura.tipoDNI ?? 'Documento', factura.DNI)] : []),
          ...(factura.direccionReceptor ? [labelValor('Dirección', factura.direccionReceptor)] : []),
          labelValor('Método de pago', formatearTextoPago(venta)),
        ],
        margin: [8, 4, 8, 4],
      }]],
    },
    layout: {
      fillColor: () => '#eeeeee',
      ...layoutLineas(),
    },
    margin: [0, 10, 0, 10],
  };

  // ── 3. Tabla de productos ─────────────────────────────────────────────────
  const tablaProductos = buildTabla(comprobante, configuracionPapel);

  // ── 4. Totales ────────────────────────────────────────────────────────────
  const tablaTotales = {
    table: {
      widths: ['50%', '50%'],
      body: [[
        // Columna izquierda — reservada para leyenda fiscal (actualmente vacía; ver comentario)
        {
          // Leyenda fiscal para tipo B — pendiente de activar cuando se confirme el texto legal:
          // f.tipoComprobante === 6
          //   ? { text: 'El crédito fiscal discriminado ...', italics: true, fontSize: 9 }
          //   : { text: '' }
        },
        // Columna derecha — números
        {
          stack: [
            ...buildTotales(resumen, configuracionPapel),
            ...buildIVA(factura, configuracionPapel),
          ],
        },
      ]],
    },
    layout: layoutLineas(),
    margin: [0, 10, 0, 0],
  };

  // ── 5. Pie — QR + datos CAE ───────────────────────────────────────────────
  const pie = {
    columns: [
      { image: factura.qr, width: 100, alignment: 'left', margin: [0, 0, 30, 0] },
      {
        stack: [
          { text: 'Comprobante Autorizado', fontSize: 10, italic: true, bold: true, margin: [8, 3, 0, 10] },
          labelValor('CAE',             factura.cae),
          labelValor('Vencimiento CAE', factura.caeVto),
          labelValor('Moneda',          'PES'),
        ],
        width: 'auto',
      },
      // Columna IVA discriminado — pendiente de activar para tipo A:
      // factura.tipoComprobante !== 11
      //   ? { stack: [...], alignment: 'right', width: '*' }
      //   : { text: '', width: '*' }
    ],
    margin: [0, 15, 0, 0],
  };

  return {
    pageSize:        'A4',
    pageOrientation: 'portrait',
    pageMargins:     [10, 10, 10, 10],
    content:         [headerTable, tablaReceptor, tablaProductos, tablaTotales, pie, ...buildMensajeExtra(comprobante, configuracionPapel)],
    styles:          estilosA4(configuracionPapel),
  };
}

/**
 * Dispatcher de NC: delega a A4 o a la versión térmica según el papel configurado.
 * No reutiliza buildDocFactura() porque ese flujo depende de Venta (resumen vía
 * calcularResumenVenta, basado en pago) — una NC no tiene pago/descuento/recargo/deuda,
 * solo un total fijo (ver buildTotalNotaCredito).
 */
function buildDocNotaCredito(
  comprobante: ComprobanteData,
  nc: NotaCreditoImpresion,
  factura: FacturaAFIP,
): object {
  const configuracionPapel = obtenerConfiguracionPapel(comprobante.papel);

  if (comprobante.papel === 'A4') {
    return buildDocNotaCreditoA4(comprobante, nc, factura, configuracionPapel);
  }

  // Layout compacto para tickets térmicos — reutiliza buildEncabezadoFactura/buildIVA/
  // buildCAE/buildQR tal cual (son genéricos sobre FacturaAFIP, no dependen de Venta).
  return {
    pageSize:    configuracionPapel.pageSize,
    pageMargins: [comprobante.margenIzq, 4, comprobante.margenDer, 4],
    content: [
      ...buildEncabezadoFactura(comprobante, factura, configuracionPapel),
      buildComprobanteAsociado(nc.comprobanteAsociado, configuracionPapel),
      buildTabla(comprobante, configuracionPapel),
      buildTotalNotaCredito(nc.total, configuracionPapel),
      ...buildIVA(factura, configuracionPapel),
      buildCAE(factura, configuracionPapel),
      buildQR(factura, configuracionPapel),
    ],
  };
}

/**
 * Layout A4 de NC. Análogo a buildDocFacturaA4: mismas tres columnas de encabezado,
 * pero la columna derecha dice "NOTA DE CRÉDITO" e incluye el comprobante asociado;
 * la tabla de receptor omite método de pago (no aplica) y suma el motivo si hay.
 */
function buildDocNotaCreditoA4(
  comprobante: ComprobanteData,
  nc: NotaCreditoImpresion,
  factura: FacturaAFIP,
  configuracionPapel: ConfiguracionPapel,
): object {
  const letraComprobante = TIPO_COMPROBANTE_LETRA[factura.tipoComprobante ?? 0] ?? 'X';
  const letraAsociada     = TIPO_COMPROBANTE_LETRA[nc.comprobanteAsociado.tipo] ?? 'X';

  const headerTable = {
    table: {
      widths: ['45%', '10%', '45%'],
      body: [[
        {
          stack: [
            ...buildLogo(comprobante),
            ...(comprobante.mostrarNombre !== false
              ? [{ text: comprobante.nombreLocal?.toUpperCase(), fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] }]
              : []),
            labelValor('Dirección',    factura.direccion),
            ...(comprobante.telefonoLocal ? [labelValor('Teléfono', comprobante.telefonoLocal)] : []),
            labelValor('Cond. IVA',   factura.condicion),
            labelValor('CUIT',        factura.CUIL),
            labelValor('Razón Social', factura.razon),
          ],
        },
        {
          // Columna fija al 10%: "NC" va en línea propia (no inline con la letra) para no
          // forzar el wrap de "NC A" a ese ancho con fontSize 25 — mismo criterio que el
          // "Cod." de abajo, una etiqueta chica + el dato grande.
          stack: [
            { text: 'NC', fontSize: 11, bold: true, alignment: 'center', margin: [0, 10, 0, 0] },
            { text: letraComprobante, fontSize: 25, bold: true, decoration: 'underline', alignment: 'center', margin: [0, 0, 0, 3] },
            { text: `Cod. ${factura.tipoComprobante}`, fontSize: 7, alignment: 'center' },
          ],
          alignment: 'center',
        },
        {
          stack: [
            { text: 'NOTA DE CRÉDITO', fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
            labelValor('Nro Comp',      `${factura.puntoVenta?.toString().padStart(4, '0')} - ${factura.ticket?.toString().padStart(8, '0')}`, true),
            labelValor('Fecha Emisión', `${comprobante.fechaVenta} - ${comprobante.horaVenta}`),
            labelValor('Asociada a',    `Factura ${letraAsociada} ${String(nc.comprobanteAsociado.ptoVenta).padStart(4, '0')}-${String(nc.comprobanteAsociado.ticket).padStart(8, '0')}`),
          ],
        },
      ]],
    },
    layout: layoutLineas(),
  };

  const condicionReceptorEsRedundante = factura.condicionReceptor === factura.clienteReceptor;

  const tablaReceptor = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          labelValor('Cliente', factura.clienteReceptor),
          ...(condicionReceptorEsRedundante ? [] : [labelValor('Condición', factura.condicionReceptor)]),
          ...(factura.DNI ? [labelValor(factura.tipoDNI ?? 'Documento', factura.DNI)] : []),
          ...(nc.motivo?.trim() ? [labelValor('Motivo', nc.motivo)] : []),
        ],
        margin: [8, 4, 8, 4],
      }]],
    },
    layout: {
      fillColor: () => '#eeeeee',
      ...layoutLineas(),
    },
    margin: [0, 10, 0, 10],
  };

  const tablaProductos = buildTabla(comprobante, configuracionPapel);

  const tablaTotales = {
    table: {
      widths: ['50%', '50%'],
      body: [[
        {},
        {
          stack: [
            buildTotalNotaCredito(nc.total, configuracionPapel),
            ...buildIVA(factura, configuracionPapel),
          ],
        },
      ]],
    },
    layout: layoutLineas(),
    margin: [0, 10, 0, 0],
  };

  const pie = {
    columns: [
      { image: factura.qr, width: 100, alignment: 'left', margin: [0, 0, 30, 0] },
      {
        stack: [
          { text: 'Comprobante Autorizado', fontSize: 10, italic: true, bold: true, margin: [8, 3, 0, 10] },
          labelValor('CAE',             factura.cae),
          labelValor('Vencimiento CAE', factura.caeVto),
          labelValor('Moneda',          'PES'),
        ],
        width: 'auto',
      },
    ],
    margin: [0, 15, 0, 0],
  };

  return {
    pageSize:        'A4',
    pageOrientation: 'portrait',
    pageMargins:     [10, 10, 10, 10],
    content:         [headerTable, tablaReceptor, tablaProductos, tablaTotales, pie],
    styles:          estilosA4(configuracionPapel),
  };
}

/** Estilos pdfmake para el documento A4. Separado del builder para mantenerlo legible. */
function estilosA4(configuracionPapel: ConfiguracionPapel): object {
  return {
    simple:           { fontSize: configuracionPapel.fontSizes.normal,  margin: [8, 0, 0, 4] },
    titulo:           { fontSize: configuracionPapel.fontSizes.titulo,  bold: true, margin: [0, 15, 0, 8] },
    tipoComprobante:  { fontSize: configuracionPapel.fontSizes.titulo + 10, bold: true, decoration: 'underline', margin: [0, 10, 0, 3] },
    tableStyle:       { fontSize: configuracionPapel.fontSizes.tabla,   margin: [0, 0, 0, 5] },
    totalProducto:    { fontSize: configuracionPapel.fontSizes.normal,  margin: [3, 1, 3, 1] },
    subtotal:         { fontSize: configuracionPapel.fontSizes.normal,  margin: [3, 12, 3, 1] },
    descuento:        { fontSize: configuracionPapel.fontSizes.normal,  margin: [3, 1, 3, 1] },
    total:            { fontSize: configuracionPapel.fontSizes.total,   bold: true, margin: [3, 10, 3, 5] },
    recargaDescuento: { fontSize: configuracionPapel.fontSizes.normal,  margin: [3, 1, 3, 1] },
    totales:          { margin: [0, 10, 0, 0] },
    leyenda:          { fontSize: configuracionPapel.fontSizes.normal - 2, italics: true, margin: [5, 5, 5, 5] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ComprobanteService
 * ------------------
 * Genera comprobantes internos y facturas AFIP en PDF usando pdfmake.
 * Soporta tres formatos de papel: 58mm, 80mm y A4.
 *
 * Flujo principal:
 *   generarComprobantePDF(venta, parametros, tipo)
 *     ├─ 'interno'  → buildDocInterno()
 *     └─ 'factura'  → mapearFactura() → buildDocFactura()
 *                        └─ (A4)    → buildDocFacturaA4()
 */
export class ComprobanteService {

  /**
   * Imprimir una venta nunca puede fallar por el logo. rutaLogo() ya descarta archivos faltantes o
   * truncados, pero un PNG con la firma y el final correctos y el medio dañado recién revienta
   * dentro de pdfmake. En ese caso se reintenta el mismo documento sin logo y se deja registro.
   */
  private async conRespaldoSinLogo(
    parametros: ParametrosComprobante,
    generar: (p: ParametrosComprobante) => Promise<Buffer>,
  ): Promise<Buffer> {
    try {
      return await generar(parametros);
    } catch (error: any) {
      if (!parametros.logo) throw error;

      logger.warn(`No se pudo renderizar el comprobante con el logo "${parametros.logo}"; se reintenta sin logo. ${error?.message ?? ''}`);
      return generar({ ...parametros, logo: null });
    }
  }

  /**
   * Punto de entrada público. Genera el Buffer del PDF listo para enviar al cliente.
   *
   * @param venta      - Venta completa con detalles, pago y factura (si aplica)
   * @param parametros - Configuración del local: papel, márgenes, nombre, etc.
   * @param tipo       - 'interno' para ticket sin datos AFIP, 'factura' para comprobante fiscal
   */
  async generarComprobantePDF(venta: Venta, parametros: ParametrosComprobante, tipo: string): Promise<Buffer> {
    return this.conRespaldoSinLogo(parametros, p => this.renderComprobante(venta, p, tipo));
  }

  private async renderComprobante(venta: Venta, parametros: ParametrosComprobante, tipo: string): Promise<Buffer> {
    const comprobante = this.mapearComprobante(venta, parametros);
    const resumen     = calcularResumenVenta(venta);

    const docDefinition = tipo === 'interno'
      ? buildDocInterno(comprobante, resumen, venta)
      : buildDocFactura(comprobante, resumen, venta, await this.mapearFactura(venta));

    return generarBufferPDF(docDefinition);
  }

  /**
   * Vista previa de configuración (Preferencias > Impresión): renderiza el comprobante con
   * datos de EJEMPLO y los parámetros borrador recibidos (aún sin guardar). Usa los mismos
   * builders que la impresión real, así que lo que se ve es el layout real.
   *
   * Nunca consulta a ARCA ni toca la base de ventas. En factura el emisor (razón social,
   * CUIT, domicilio fiscal) es el real —es lo que el usuario necesita ver—, pero CAE y QR son
   * ficticios, y todo documento sale con marca de agua "VISTA PREVIA" para que no pueda
   * confundirse con un comprobante fiscal.
   */
  async generarVistaPrevia(tipo: TipoVistaPrevia, parametros: ParametrosComprobante): Promise<Buffer> {
    return this.conRespaldoSinLogo(parametros, p => this.renderVistaPrevia(tipo, p));
  }

  private async renderVistaPrevia(tipo: TipoVistaPrevia, parametros: ParametrosComprobante): Promise<Buffer> {
    let docDefinition: object;

    if (tipo === 'presupuesto') {
      const { comprobante, datos } = this.mapearPresupuestoComprobante(presupuestoMuestra(), detallesPresupuestoMuestra(), parametros);
      docDefinition = buildDocPresupuesto(comprobante, datos);
    } else {
      const venta       = ventaMuestra();
      const comprobante = this.mapearComprobante(venta, parametros);
      const resumen     = calcularResumenVenta(venta);

      docDefinition = tipo === 'interno'
        ? buildDocInterno(comprobante, resumen, venta)
        : buildDocFactura(comprobante, resumen, venta, await this.mapearFacturaMuestra());
    }

    return generarBufferPDF({
      ...docDefinition,
      watermark: { text: 'VISTA PREVIA', color: '#808080', opacity: 0.18, bold: true },
    });
  }

  /** FacturaAFIP ficticia para la vista previa. Ver generarVistaPrevia(). */
  private async mapearFacturaMuestra(): Promise<FacturaAFIP> {
    const emisor = await ParametrosRepo.ObtenerParametrosFacturacion();
    const esRI   = emisor?.condicion === 'responsable_inscripto';
    const tipo   = esRI ? 6 : 11;   // Factura B (RI a consumidor final) / Factura C (monotributo)

    const neto = Math.round((TOTAL_MUESTRA / 1.21) * 100) / 100;
    const vto  = new Date();
    vto.setDate(vto.getDate() + 10);

    return {
      puntoVenta:         emisor?.puntoVta ?? 1,
      ticket:             1,
      neto,
      iva:                Math.round((TOTAL_MUESTRA - neto) * 100) / 100,
      cae:                '00000000000000',
      caeVto:             vto.toLocaleDateString('es-AR'),
      tipoComprobante:    tipo,
      desTipoComprobante: TIPO_COMPROBANTE_LETRA[tipo],
      condicion:          esRI ? 'RESPONSABLE INSCRIPTO' : 'MONOTRIBUTISTA',
      razon:              emisor?.razon     ?? 'Razón social de ejemplo',
      direccion:          emisor?.direccion ?? 'Domicilio fiscal de ejemplo',
      CUIL:               emisor?.cuil      ?? '20000000000',
      condicionReceptor:  'Consumidor Final',
      clienteReceptor:    'Consumidor Final',
      DNI:                undefined,
      tipoDNI:            undefined,
      qr:                 await QRCode.toDataURL('https://www.arca.gob.ar/fe/qr/?p=VISTA-PREVIA'),
    };
  }

  /**
   * Punto de entrada para PDF de presupuestos — documento simple sin datos fiscales.
   *
   * @param presupuesto - Presupuesto con cliente cargado
   * @param detalles    - Líneas de producto del presupuesto
   * @param parametros  - Configuración del local: papel, márgenes, nombre, etc.
   */
  async generarPresupuestoPDF(presupuesto: Presupuesto, detalles: DetallePresupuesto[], parametros: ParametrosComprobante): Promise<Buffer> {
    return this.conRespaldoSinLogo(parametros, p => this.renderPresupuesto(presupuesto, detalles, p));
  }

  private async renderPresupuesto(presupuesto: Presupuesto, detalles: DetallePresupuesto[], parametros: ParametrosComprobante): Promise<Buffer> {
    const { comprobante, datos } = this.mapearPresupuestoComprobante(presupuesto, detalles, parametros);
    const docDefinition = buildDocPresupuesto(comprobante, datos);

    return generarBufferPDF(docDefinition);
  }

  /**
   * Normaliza el presupuesto + detalle + parámetros en la pareja (ComprobanteData, PresupuestoComprobante)
   * que consume buildDocPresupuesto(). Misma idea que mapearComprobante() pero sin pago/factura.
   */
  private mapearPresupuestoComprobante(
    presupuesto: Presupuesto,
    detalles: DetallePresupuesto[],
    parametros: ParametrosComprobante,
  ): { comprobante: ComprobanteData; datos: PresupuestoComprobante } {
    const configuracionPapel = obtenerConfiguracionPapel(parametros.papel);
    const fecha    = new Date(presupuesto.fecha!);
    const validez  = new Date(presupuesto.validezHasta!);

    const comprobante: ComprobanteData = {
      papel:            parametros.papel,
      margenIzq:        parametros.margenIzq,
      margenDer:        parametros.margenDer,
      nombreLocal:      parametros.nomLocal,
      descripcionLocal: parametros.desLocal,
      ...resolverPersonalizacion(parametros),
      fechaVenta:       fecha.toLocaleDateString('es-ES'),
      horaVenta:        '',
      filasTabla:       buildFilasDetallePresupuesto(detalles, configuracionPapel),
    };

    const datos: PresupuestoComprobante = {
      numero:       presupuesto.id!,
      validezHasta: validez.toLocaleDateString('es-ES'),
      cliente:      presupuesto.cliente?.nombre,
      total:        presupuesto.total ?? 0,
    };

    return { comprobante, datos };
  }

  /**
   * Normaliza la venta + parámetros en un ComprobanteData listo para los builders.
   * También pre-construye las filas de la tabla mientras el cfg está disponible.
   */
  private mapearComprobante(venta: Venta, parametros: ParametrosComprobante): ComprobanteData {
    const configuracionPapel = obtenerConfiguracionPapel(parametros.papel);
    const fecha              = new Date(venta.fecha!);

    return {
      papel:            parametros.papel,
      margenIzq:        parametros.margenIzq,
      margenDer:        parametros.margenDer,
      nombreLocal:      parametros.nomLocal,
      descripcionLocal: parametros.desLocal,
      ...resolverPersonalizacion(parametros),
      fechaVenta:       fecha.toLocaleDateString('es-ES'),
      horaVenta:        venta.hora,
      filasTabla:       buildFilasDetalle(venta, configuracionPapel),
      mostrarObservaciones: activo(parametros.mostrarObservaciones),
    };
  }

  /**
   * Construye el objeto FacturaAFIP cruzando la venta con los parámetros de facturación.
   * Consulta el QR a AFIP — puede fallar si el servicio externo no responde.
   */
  private async mapearFactura(venta: Venta): Promise<FacturaAFIP> {
    const facturaVenta = venta.factura!;
    const parametros   = await ParametrosRepo.ObtenerParametrosFacturacion();

    const tipoDNI            = TIPOS_DOCUMENTO.find(t => t.id === facturaVenta.tipoDni)?.descripcion;
    const condicionReceptor  = CONDICIONES_IVA_RECEPTOR.find(t => t.id === facturaVenta.condReceptor)?.descripcion;

    return {
      puntoVenta:          facturaVenta.ptoVenta,
      ticket:              facturaVenta.ticket,
      neto:                facturaVenta.neto,
      iva:                 facturaVenta.iva,
      cae:                 facturaVenta.cae,
      caeVto:              new Date(facturaVenta.caeVto!).toLocaleDateString('es-AR'),
      tipoComprobante:     facturaVenta.tipoComprobante,
      desTipoComprobante:  TIPO_COMPROBANTE_LETRA[facturaVenta.tipoComprobante ?? 0] ?? '',
      condicion:           parametros.condicion === 'responsable_inscripto'
                             ? 'RESPONSABLE INSCRIPTO'
                             : 'MONOTRIBUTISTA',
      razon:               parametros.razon,
      direccion:           parametros.direccion,
      CUIL:                parametros.cuil,
      condicionReceptor,
      // El receptor sale del snapshot congelado en la factura, no de venta.cliente: al
      // facturar una venta ya registrada el cliente elegido en el modal puede no ser el
      // de la venta (tipicamente la venta quedo en Consumidor Final). El fallback a
      // venta.cliente cubre las facturas anteriores a la migracion 20260728100000.
      clienteReceptor:     venta.factura?.receptorNombre || venta.cliente?.razonSocial || venta.cliente?.nombre || 'Consumidor Final',
      direccionReceptor:   venta.factura?.receptorDireccion || venta.cliente?.direccion || undefined,
      DNI:                 facturaVenta.dni,
      tipoDNI,
      qr:                  await FacturacionServ.ObtenerQRFactura(venta.id),
    };
  }

  /**
   * Punto de entrada público para PDF de Nota de Crédito.
   * NotaCreditoService ya resolvió todo (CAE, QR, receptor) al emitir la NC contra
   * AFIP — esta función no vuelve a consultar la DB ni a llamar a AFIP, solo arma el PDF.
   */
  async generarNotaCreditoPDF(nc: NotaCreditoImpresion, parametros: ParametrosComprobante): Promise<Buffer> {
    return this.conRespaldoSinLogo(parametros, p => this.renderNotaCredito(nc, p));
  }

  /**
   * PDF del resumen de caja (Fase 3.4-C). `datos` lo arma CierreCajaServ.ArmarImpresion (ya recortado
   * si es arqueo ciego); `papel` pisa al del parámetro cuando se pide explícitamente (ej: A4 para vista previa).
   */
  async generarResumenCajaPDF(datos: ResumenCajaImpresion, parametros: ParametrosComprobante, papel?: string): Promise<Buffer> {
    const p = { ...parametros, papel: papel ?? parametros.papel };
    return this.conRespaldoSinLogo(p, x => this.renderResumenCaja(datos, x));
  }

  private async renderResumenCaja(datos: ResumenCajaImpresion, parametros: ParametrosComprobante): Promise<Buffer> {
    const [fecha, hora] = datos.impreso.split(' ');
    const comprobante: ComprobanteData = {
      papel:            parametros.papel,
      margenIzq:        parametros.margenIzq,
      margenDer:        parametros.margenDer,
      nombreLocal:      parametros.nomLocal,
      descripcionLocal: parametros.desLocal,
      ...resolverPersonalizacion(parametros),
      fechaVenta:       fecha,
      horaVenta:        hora,
      filasTabla:       [],
    };
    return generarBufferPDF(buildDocResumenCaja(comprobante, datos));
  }

  private async renderNotaCredito(nc: NotaCreditoImpresion, parametros: ParametrosComprobante): Promise<Buffer> {
    const comprobante  = this.mapearComprobanteNotaCredito(nc, parametros);
    const facturaAFIP  = await this.mapearNotaCredito(nc);
    const docDefinition = buildDocNotaCredito(comprobante, nc, facturaAFIP);

    return generarBufferPDF(docDefinition);
  }

  /**
   * Normaliza la NC + parámetros del local en un ComprobanteData listo para los builders.
   * Análoga a mapearComprobante(), pero la fecha/hora viene de nc.fecha (una NC no tiene
   * el concepto de Venta.hora) y la tabla sale de buildFilasDetalleNotaCredito().
   */
  private mapearComprobanteNotaCredito(nc: NotaCreditoImpresion, parametros: ParametrosComprobante): ComprobanteData {
    const configuracionPapel = obtenerConfiguracionPapel(parametros.papel);
    const fecha              = new Date(nc.fecha);

    return {
      papel:            parametros.papel,
      margenIzq:        parametros.margenIzq,
      margenDer:        parametros.margenDer,
      nombreLocal:      parametros.nomLocal,
      descripcionLocal: parametros.desLocal,
      ...resolverPersonalizacion(parametros),
      fechaVenta:       fecha.toLocaleDateString('es-ES'),
      horaVenta:        fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }),
      filasTabla:       buildFilasDetalleNotaCredito(nc.detalles, configuracionPapel),
    };
  }

  /**
   * Construye el FacturaAFIP de la NC a partir del propio NotaCreditoImpresion —no de
   * venta.factura como en mapearFactura()—, porque la NC tiene su propio CAE/ticket/
   * tipoComprobante/QR. Los datos del emisor (razón social, CUIL, dirección) siguen
   * saliendo de ParametrosRepo porque son los mismos para cualquier comprobante del local.
   */
  private async mapearNotaCredito(nc: NotaCreditoImpresion): Promise<FacturaAFIP> {
    const parametros = await ParametrosRepo.ObtenerParametrosFacturacion();

    const tipoDNI           = TIPOS_DOCUMENTO.find(t => t.id === nc.tipoDni)?.descripcion;
    const condicionReceptor = CONDICIONES_IVA_RECEPTOR.find(t => t.id === nc.condReceptor)?.descripcion;

    return {
      puntoVenta:          nc.ptoVenta,
      ticket:              nc.ticket,
      neto:                nc.neto,
      iva:                 nc.iva,
      cae:                 nc.cae,
      caeVto:              new Date(nc.caeVto).toLocaleDateString('es-AR'),
      tipoComprobante:     nc.tipo,
      desTipoComprobante:  TIPO_COMPROBANTE_LETRA[nc.tipo ?? 0] ?? '',
      condicion:           parametros.condicion === 'responsable_inscripto'
                             ? 'RESPONSABLE INSCRIPTO'
                             : 'MONOTRIBUTISTA',
      razon:               parametros.razon,
      direccion:           parametros.direccion,
      CUIL:                parametros.cuil,
      condicionReceptor,
      clienteReceptor:     nc.clienteReceptor,
      DNI:                 nc.dni,
      tipoDNI,
      qr:                  nc.qr,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUMEN DE CAJA (Fase 3.4-C)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lo arma CierreCajaServ.ArmarImpresion. El builder no consulta nada: si el pedido es de un arqueo
 * ciego, `resumen` y `cierre` llegan YA recortados (sin esperado, diferencia, cajón, fondo ni info),
 * así que acá no hay nada que filtrar ni nada que pueda filtrarse por error.
 */
export interface ResumenCajaImpresion {
  modo: 'parcial' | 'cierre' | 'sinCierre';
  ciego: boolean;
  /** "cierre 1 de 2": solo si se imprime un cierre que no es el último de la caja. */
  reimpresion: { numero: number; total: number } | null;
  /** Salida de ResumenCajaServ.Calcular o su foto JSON (cajas_cierres.resumen). Se lee defensivamente. */
  resumen: any;
  cierre: {
    fecha: string;                 // DD/MM/AAAA
    hora: string;                  // HH:mm
    usuario: string | null;
    puesto: string | null;
    esperado: number | null;       // null en arqueo ciego
    contado: number | null;
    diferencia: number | null;     // null en arqueo ciego o si se cerró sin contar
    observacion: string | null;
  } | null;
  impreso: string;                 // 'DD/MM/AAAA HH:mm' del servidor
}

type FilaCaja = { label: string; valor: string; negrita?: boolean };

const SIGNO_MENOS = '−';

/**
 * Monto de caja: "$ 216.900,00". SIEMPRE 2 decimales y sin depender del papel ni de ICU (es plata
 * contada; formatearMoneda() usa 1 decimal en térmicas). Negativos: "−$ 1.500,00".
 */
function montoCaja(valor: unknown, comoEgreso = false): string {
  const bruto = Number(valor ?? 0);
  const n = Number.isFinite(bruto) ? bruto : 0;
  const [entero, decimales] = Math.abs(n).toFixed(2).split('.');
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${(comoEgreso || n < 0) && n !== 0 ? SIGNO_MENOS : ''}$ ${miles},${decimales}`;
}

/** 'YYYY-MM-DD' (como la guarda la foto del resumen) -> 'DD/MM/AAAA'. Otro formato se deja como viene. */
function fechaCajaCorta(fecha: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(fecha ?? '');
}

/** Agrega la fila solo si el monto no es cero (las líneas en cero no se imprimen). */
function sumarFilaCaja(filas: FilaCaja[], label: string, valor: unknown, comoEgreso = false): void {
  const n = Number(valor ?? 0);
  if (Number.isFinite(n) && n !== 0) filas.push({ label, valor: montoCaja(n, comoEgreso) });
}

function seccionCajonCaja(d: ResumenCajaImpresion): { filas: FilaCaja[]; notas: string[] } {
  const filas: FilaCaja[] = [];
  const notas: string[] = [];
  const c = d.resumen?.cajon ?? {};

  if (!d.ciego) {
    sumarFilaCaja(filas, 'Cambio inicial', c.cambioInicial);
    sumarFilaCaja(filas, 'Ventas en efectivo', c.ventasEfectivo);
    sumarFilaCaja(filas, 'Cobros imputados', c.cobrosImputados);
    sumarFilaCaja(filas, 'Ingresos', c.ingresos);
    sumarFilaCaja(filas, 'Egresos', c.egresos, true);
    sumarFilaCaja(filas, 'Pagos a proveedores', c.pagosProveedorSinFondo, true);
    sumarFilaCaja(filas, 'Excedente proveedores', c.excedenteProveedores, true);
    filas.push({ label: 'ESPERADO', valor: montoCaja(d.cierre?.esperado ?? c.esperado), negrita: true });
  }

  const cierre = d.cierre;
  if (d.modo === 'cierre' && cierre) {
    if (cierre.contado != null) {
      filas.push({ label: 'CONTADO', valor: montoCaja(cierre.contado), negrita: true });
      if (!d.ciego && cierre.diferencia != null) {
        const dif = Number(cierre.diferencia);
        filas.push({
          label: dif < 0 ? 'FALTANTE' : dif > 0 ? 'SOBRANTE' : 'JUSTO',
          valor: montoCaja(Math.abs(dif)),
          negrita: true,
        });
      }
    } else {
      notas.push('Se cerró sin contar el efectivo');
    }
  }
  return { filas, notas };
}

function seccionFondoCaja(d: ResumenCajaImpresion): { filas: FilaCaja[]; notas: string[] } | null {
  const f = d.resumen?.fondo;
  if (d.ciego || !f) return null;

  const filas: FilaCaja[] = [{ label: 'Asignado', valor: montoCaja(f.asignado) }];
  const notas: string[] = [];
  sumarFilaCaja(filas, 'Pagos', f.pagado, true);
  filas.push({ label: 'Disponible', valor: montoCaja(f.disponible), negrita: true });
  if (Number(f.excedente ?? 0) > 0) {
    filas.push({ label: 'Excedente', valor: montoCaja(f.excedente, true) });
    notas.push('El excedente salió del cajón');
  }
  return { filas, notas };
}

function seccionMediosCaja(d: ResumenCajaImpresion, esA4: boolean): FilaCaja[] {
  if (d.ciego) return [];
  const medios: any[] = Array.isArray(d.resumen?.otrosMedios) ? d.resumen.otrosMedios : [];
  return medios.map(m => ({
    label: esA4 && m.cantidadVentas != null ? `${m.medio} (${m.cantidadVentas} ventas)` : String(m.medio ?? ''),
    valor: montoCaja(m.total),
  }));
}

function seccionInfoCaja(d: ResumenCajaImpresion): FilaCaja[] {
  if (d.ciego) return [];
  const i = d.resumen?.info ?? {};
  const filas: FilaCaja[] = [];

  // Si la foto no trae el dato, no se inventa un 0 (en un cierre sería engañoso).
  if (i.totalVendido != null) {
    filas.push({ label: `Total vendido (${Number(i.cantidadVentas ?? 0)})`, valor: montoCaja(i.totalVendido) });
  }
  sumarFilaCaja(filas, 'Fiado', i.fiado);
  sumarFilaCaja(filas, 'Saldo a favor usado', i.saldoAFavorUsado);

  const fuera = i.cobrosFueraDeCaja;
  if (fuera && (Number(fuera.cantidad ?? 0) > 0 || Number(fuera.total ?? 0) !== 0)) {
    filas.push({ label: `Cobros fuera de caja (${Number(fuera.cantidad ?? 0)})`, valor: montoCaja(fuera.total) });
  }
  const nc = i.notasCredito;
  if (nc && Number(nc.cantidad ?? 0) > 0) {
    filas.push({ label: `Notas de crédito (${Number(nc.cantidad)})`, valor: montoCaja(nc.total) });
  }
  const an = i.anulaciones;
  if (an && Number(an.cantidad ?? 0) > 0) {
    filas.push({ label: `Anulaciones (${Number(an.cantidad)})`, valor: montoCaja(an.total) });
  }
  return filas;
}

/** Título + subtítulos según el modo (ver tabla de reglas del handoff 3.4-C §2). */
function tituloResumenCaja(d: ResumenCajaImpresion): { titulo: string; subtitulos: string[] } {
  let titulo: string;
  const subtitulos: string[] = [];

  if (d.modo === 'parcial') {
    titulo = 'RESUMEN PARCIAL — CAJA ABIERTA';
    subtitulos.push(`Impreso ${d.impreso}`);
  } else if (d.modo === 'cierre') {
    titulo = 'CIERRE DE CAJA';
    if (d.reimpresion) subtitulos.push(`REIMPRESIÓN — cierre ${d.reimpresion.numero} de ${d.reimpresion.total}`);
  } else {
    titulo = 'RESUMEN DE CAJA';
    subtitulos.push('Cerrada antes del registro de cierres: sin arqueo');
  }
  if (d.resumen?.caja?.historica && !d.ciego) {
    subtitulos.push('Caja anterior al nuevo cálculo: el total vendido sale del acumulador');
  }
  return { titulo, subtitulos };
}

/** Líneas "Caja / Cajero / Apertura / Cierre / Cerró" (las que no aplican no se incluyen). */
function datosCabeceraCaja(d: ResumenCajaImpresion): { label: string; valor: string }[] {
  const caja = d.resumen?.caja ?? {};
  const lineas: { label: string; valor: string }[] = [
    { label: 'Caja', valor: `#${caja.id ?? ''}` },
    { label: 'Cajero', valor: String(caja.responsable ?? '—') },
  ];
  if (caja.apertura?.fecha) {
    lineas.push({ label: 'Apertura', valor: `${fechaCajaCorta(caja.apertura.fecha)} ${String(caja.apertura.hora ?? '').slice(0, 5)}`.trim() });
  }
  if (d.modo === 'cierre' && d.cierre) {
    lineas.push({ label: 'Cierre', valor: `${d.cierre.fecha} ${d.cierre.hora}`.trim() });
    const quien = [d.cierre.usuario, d.cierre.puesto].filter(Boolean).join(' · ');
    if (quien) lineas.push({ label: 'Cerró', valor: quien });
  }
  return lineas;
}

const LAYOUT_SIN_BORDES = {
  hLineWidth: () => 0, vLineWidth: () => 0,
  paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 1, paddingBottom: () => 1,
};

/** Tabla etiqueta-izquierda / monto-derecha, sin bordes. */
function tablaFilasCaja(filas: FilaCaja[], tamano: number, tamanoNegrita: number): object {
  return {
    table: {
      widths: ['*', 'auto'],
      body: filas.map(f => [
        { text: f.label, bold: !!f.negrita, fontSize: f.negrita ? tamanoNegrita : tamano },
        { text: f.valor, bold: !!f.negrita, fontSize: f.negrita ? tamanoNegrita : tamano, alignment: 'right' },
      ]),
    },
    layout: LAYOUT_SIN_BORDES,
    margin: [0, 0, 0, 2],
  };
}

/** Bloque: título de sección + tabla + notas. Vacío si no hay nada que mostrar. */
function bloqueSeccionCaja(titulo: string, filas: FilaCaja[], notas: string[], tamano: number, tamanoNegrita: number): object[] {
  if (!filas.length && !notas.length) return [];
  return [
    { text: titulo, bold: true, fontSize: tamano, margin: [0, 6, 0, 2] },
    ...(filas.length ? [tablaFilasCaja(filas, tamano, tamanoNegrita)] : []),
    ...notas.map(n => ({ text: n, italics: true, fontSize: tamano - 1, margin: [0, 1, 0, 1] })),
  ];
}

/** Recuadro de firma, mismo patrón que buildObservaciones (widths ['*'], alto fijo). */
function recuadroFirmaCaja(titulo: string, tamano: number): object {
  return {
    stack: [
      { text: titulo, fontSize: tamano, bold: true, margin: [0, 6, 0, 2] },
      {
        table: { widths: ['*'], heights: [34], body: [['']] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000000', vLineColor: () => '#000000' },
      },
    ],
  };
}

function bloqueObservacionCaja(d: ResumenCajaImpresion, tamano: number): object[] {
  const obs = d.cierre?.observacion?.trim();
  if (!obs) return [];
  return [
    { text: 'OBSERVACIÓN', bold: true, fontSize: tamano, margin: [0, 6, 0, 2] },
    { text: obs, fontSize: tamano },
  ];
}

function buildDocResumenCaja(comprobante: ComprobanteData, d: ResumenCajaImpresion): object {
  const configuracionPapel = obtenerConfiguracionPapel(comprobante.papel);
  return comprobante.papel === 'A4'
    ? buildDocResumenCajaA4(comprobante, d, configuracionPapel)
    : buildDocResumenCajaTicket(comprobante, d, configuracionPapel);
}

/** 58mm / 80mm: una columna, alto 'auto' (un solo rollo, un solo corte). Sin detalle de anulaciones ni cobros. */
function buildDocResumenCajaTicket(comprobante: ComprobanteData, d: ResumenCajaImpresion, cfg: ConfiguracionPapel): object {
  const normal  = cfg.fontSizes.normal;
  const grande  = cfg.fontSizes.total;
  const { titulo, subtitulos } = tituloResumenCaja(d);

  // buildEncabezado devuelve, en térmicas, un array cuyo último elemento es la línea de fecha/hora:
  // se descarta porque el pie ya dice "Impreso ..." (no repetir la hora en un ticket angosto).
  const encabezado = (buildEncabezado(comprobante, cfg) as unknown as object[]).slice(0, -1);

  const cajon = seccionCajonCaja(d);
  const fondo = seccionFondoCaja(d);
  const medios = seccionMediosCaja(d, false);
  const info = seccionInfoCaja(d);

  return {
    pageSize:    cfg.pageSize,
    pageMargins: [comprobante.margenIzq, 4, comprobante.margenDer, 4],
    content: [
      ...encabezado,
      buildSeparador(comprobante, cfg),
      { text: titulo, bold: true, alignment: 'center', fontSize: cfg.fontSizes.titulo - 2, margin: [0, 2, 0, 2] },
      ...subtitulos.map(s => ({ text: s, alignment: 'center', fontSize: normal - 1, margin: [0, 0, 0, 1] })),
      buildSeparador(comprobante, cfg),
      tablaFilasCaja(datosCabeceraCaja(d).map(l => ({ label: l.label, valor: l.valor })), normal, normal),
      ...bloqueSeccionCaja('CAJÓN (EFECTIVO)', cajon.filas, cajon.notas, normal, grande),
      ...(fondo ? bloqueSeccionCaja('FONDO PROVEEDORES', fondo.filas, fondo.notas, normal, normal) : []),
      ...bloqueSeccionCaja('OTROS MEDIOS', medios, [], normal, normal),
      ...bloqueSeccionCaja('INFORMACIÓN', info, [], normal, normal),
      ...bloqueObservacionCaja(d, normal),
      ...(d.modo === 'cierre' ? [recuadroFirmaCaja('Cajero', normal), recuadroFirmaCaja('Encargado', normal)] : []),
      { text: `Impreso ${d.impreso} · EasySales`, alignment: 'center', fontSize: normal - 1, margin: [0, 8, 0, 0] },
    ],
    defaultStyle: { font: 'Roboto' },
  };
}

/** A4: más aire, cajón y fondo en dos columnas, y tablas de anulaciones y cobros fuera de caja. */
function buildDocResumenCajaA4(comprobante: ComprobanteData, d: ResumenCajaImpresion, cfg: ConfiguracionPapel): object {
  const t = 10;       // tamaño base A4 para filas (el 12 de cfg.normal queda grande para tablas de montos)
  const { titulo, subtitulos } = tituloResumenCaja(d);

  const cajon = seccionCajonCaja(d);
  const fondo = seccionFondoCaja(d);
  const medios = seccionMediosCaja(d, true);
  const info = seccionInfoCaja(d);

  const datos = datosCabeceraCaja(d);
  const mitad = Math.ceil(datos.length / 2);
  const columnaDatos = (ls: { label: string; valor: string }[]) => ({ width: '*', stack: ls.map(l => labelValor(l.label, l.valor)) });

  const anulaciones: any[] = d.ciego ? [] : (d.resumen?.info?.anulaciones?.items ?? []);
  const cobrosFuera: any[] = d.ciego ? [] : (d.resumen?.info?.cobrosFueraDeCaja?.items ?? []);
  const encabezadoTabla = (...textos: string[]) => textos.map(x => ({ text: x, bold: true, fontSize: t, fillColor: '#eeeeee' }));

  const bloqueTabla = (tituloTabla: string, widths: any[], header: object[], filas: object[][]): object[] => filas.length ? [
    { text: tituloTabla, bold: true, fontSize: t, margin: [0, 10, 0, 2] },
    { table: { headerRows: 1, dontBreakRows: true, widths, body: [header, ...filas] }, layout: layoutLineas() },
  ] : [];

  return {
    pageSize:    cfg.pageSize,
    pageMargins: [10, 10, 10, 10],
    content: [
      buildEncabezado(comprobante, cfg, false, { titulo }),
      ...subtitulos.map(s => ({ text: s, alignment: 'center', bold: true, fontSize: t, margin: [0, 4, 0, 0] })),
      { columns: [columnaDatos(datos.slice(0, mitad)), columnaDatos(datos.slice(mitad))], margin: [0, 8, 0, 0] },
      {
        columns: [
          { width: '*', stack: bloqueSeccionCaja('CAJÓN (EFECTIVO)', cajon.filas, cajon.notas, t, 12) },
          { width: '*', stack: fondo ? bloqueSeccionCaja('FONDO PROVEEDORES', fondo.filas, fondo.notas, t, t) : [] },
        ],
        columnGap: 24,
      },
      ...bloqueSeccionCaja('OTROS MEDIOS', medios, [], t, t),
      ...bloqueSeccionCaja('INFORMACIÓN', info, [], t, t),
      ...bloqueTabla('ANULACIONES', [50, 45, 90, '*'], encabezadoTabla('Venta #', 'Hora', 'Total', 'Usuario'),
        anulaciones.map(a => [
          { text: `#${a.idVenta}`, fontSize: t }, { text: a.hora ?? '', fontSize: t },
          { text: montoCaja(a.total), fontSize: t, alignment: 'right' }, { text: a.usuario ?? '', fontSize: t },
        ])),
      ...bloqueTabla('COBROS FUERA DE CAJA', [45, '*', 90, 90], encabezadoTabla('Hora', 'Cliente', 'Medio', 'Monto'),
        cobrosFuera.map(c => [
          { text: c.hora ? String(c.hora).slice(0, 5) : '', fontSize: t }, { text: c.cliente ?? '', fontSize: t },
          { text: c.metodo ?? '', fontSize: t }, { text: montoCaja(c.monto), fontSize: t, alignment: 'right' },
        ])),
      ...bloqueObservacionCaja(d, t),
      ...(d.modo === 'cierre'
        ? [{ columns: [recuadroFirmaCaja('Cajero', t), recuadroFirmaCaja('Encargado', t)], columnGap: 24, margin: [0, 10, 0, 0] }]
        : []),
      { text: `Impreso ${d.impreso} · EasySales`, alignment: 'center', fontSize: t - 1, margin: [0, 12, 0, 0] },
    ],
    defaultStyle: { font: 'Roboto' },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES INTERNAS
// ─────────────────────────────────────────────────────────────────────────────

/** Retorna la configuración del papel solicitado, con fallback a 80mm si no existe. */
function obtenerConfiguracionPapel(papel: string): ConfiguracionPapel {
  return CONFIGURACIONES_PAPEL[papel] ?? CONFIGURACIONES_PAPEL['80mm'];
}

/** Genera un Buffer del PDF a partir de un docDefinition de pdfmake. */
function generarBufferPDF(docDefinition: object): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const chunks: Uint8Array[] = [];
      const pdfDoc = printer.createPdfKitDocument(docDefinition);

      pdfDoc.on('data',  (chunk: Uint8Array) => chunks.push(chunk));
      pdfDoc.on('end',   ()                  => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);

      pdfDoc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Calcula el resumen financiero de la venta para la sección de totales.
 * Determina si hay descuento, recargo, y si el cliente quedó con deuda.
 */
function calcularResumenVenta(venta: Venta): ResumenVenta | null {
  const pago = venta?.pago;
  if (!pago) return null;

  const subtotal  = pago.monto    ?? 0;
  const descuento = pago.descuento ?? 0;
  const recargo   = pago.recargo   ?? 0;

  const tipo = descuento > 0 ? 'descuento' : recargo > 0 ? 'recargo' : null;

  let montoAjuste            = 0;
  let porcentaje: number | null = null;

  if (tipo) {
    const valor = tipo === 'descuento' ? descuento : recargo;

    if (pago.tipoModificador === 'porcentaje') {
      porcentaje  = valor;
      montoAjuste = subtotal * (valor / 100);
    } else {
      montoAjuste = valor;
    }
  }

  const total     = venta.total ?? subtotal;
  const entregado = pago.entrega  ?? 0;
  const restante  = pago.restante ?? 0;
  const tieneDeuda = restante > 0;

  return {
    subtotal,
    total,
    montoAjuste,
    tipo,
    porcentaje,
    entregado,
    restante,
    tieneDeuda,
    // Si hay deuda se muestra el saldo pendiente como totalMostrar — útil para cuentas corrientes
    totalMostrar: tieneDeuda ? restante : total,
  };
}
