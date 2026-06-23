import path from "path";
import PdfPrinter from 'pdfmake';
import { ParametrosRepo } from "../data/parametrosRepository";
import { FacturacionServ } from "./facturacionService";
import { Venta } from "../models/Venta";
import { Presupuesto } from "../models/Presupuesto";
import { DetallePresupuesto } from "../models/DetallePresupuesto";

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

/** Código AFIP → letra visible en el comprobante (A, B, C). */
const TIPO_COMPROBANTE_LETRA: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };

const printer = new PdfPrinter(fonts);

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/** Propiedades visuales y de layout para cada tamaño de papel soportado. */
interface ConfiguracionPapel {
  pageSize:     string | { width: number; height: number };
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
  condicionReceptor:  string | undefined;
  /** Nombre/razón social a mostrar para el receptor — ya resuelto con fallback "Consumidor Final". */
  clienteReceptor:    string;
  DNI:                number | undefined;
  tipoDNI:            string | undefined;
  qr:                 string;
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
    pageSize:     { width: 140, height: 800 },
    fontSizes:    { titulo: 11, normal: 7, tabla: 6.5, total: 9 },
    marginTop:    1,
    tableMargin:  [0, 3, 0, 2],
    maxChars:     25,   // espacio muy limitado: sin truncado los nombres largos rompen el layout de tabla
    decimales:    1,    // 1 decimal ahorra espacio horizontal en ticket angosto
    cantDecimals: 0,    // entero ("2" en vez de "2.00") porque la columna C es muy estrecha
    qrWidth:      100,
  },

  '80mm': {
    pageSize:     { width: 200, height: 800 },
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
 * Encabezado del comprobante: nombre del local, descripción, dirección y fecha.
 *
 * A4 usa dos columnas (nombre izquierda | fecha derecha).
 * Térmicas usan bloques centrados apilados para aprovechar el ancho limitado verticalmente.
 */
function buildEncabezado(
  comprobante: ComprobanteData,
  configuracionPapel: ConfiguracionPapel,
  esFactura = false,
): object {
  if (comprobante.papel === 'A4') {
    return {
      columns: [
        { text: comprobante.nombreLocal?.toUpperCase(), bold: true, fontSize: configuracionPapel.fontSizes.titulo },
        { text: `${comprobante.fechaVenta} ${comprobante.horaVenta}`, alignment: 'right', fontSize: configuracionPapel.fontSizes.normal },
      ],
      margin: [0, 0, 0, configuracionPapel.marginTop],
    };
  }

  const filas = [
    { text: comprobante.nombreLocal?.toUpperCase(), alignment: 'center', fontSize: configuracionPapel.fontSizes.titulo, bold: true },

    comprobante.descripcionLocal?.trim()
      ? { text: comprobante.descripcionLocal, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal }
      : null,

    // En facturas AFIP la dirección ya aparece en el bloque del emisor — no duplicar
    (!esFactura && comprobante.direccionLocal?.trim())
      ? { text: comprobante.direccionLocal, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal }
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

  // Letra del comprobante en recuadro centrado — AFIP lo requiere visible y destacado
  filas.push({
    columns: [
      { width: '*', text: '' },
      {
        width: 'auto',
        table: {
          body: [[{
            stack: [
              { text: letraComprobante, alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.titulo + 4 },
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

  filas.push(
    { text: 'Receptor',             alignment: 'center', bold: true, fontSize: configuracionPapel.fontSizes.normal - 1 },
    { text: factura.clienteReceptor, alignment: 'center',             fontSize: configuracionPapel.fontSizes.normal - 1, margin: (receptor && !receptorEsRedundante) ? [0, 0, 0, 0] : [0, 0, 0, 2] },
  );
  if (receptor && !receptorEsRedundante) {
    filas.push(
      { text: receptor, alignment: 'center', fontSize: configuracionPapel.fontSizes.normal - 1, margin: [0, 0, 0, 2] },
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
      buildEncabezado(comprobante, configuracionPapel),
      ...buildClienteYPago(venta, configuracionPapel),
      buildTabla(comprobante, configuracionPapel),
      ...buildTotales(resumen, configuracionPapel),
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
      buildEncabezado(comprobante, configuracionPapel),
      {
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
            { text: comprobante.nombreLocal?.toUpperCase(), fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
            labelValor('Dirección',    factura.direccion),
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
  const tablaReceptor = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          labelValor('Cliente',        factura.clienteReceptor),
          labelValor('Condición',      factura.condicionReceptor),
          ...(factura.DNI ? [labelValor(factura.tipoDNI ?? 'Documento', factura.DNI)] : []),
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
   * Punto de entrada público. Genera el Buffer del PDF listo para enviar al cliente.
   *
   * @param venta      - Venta completa con detalles, pago y factura (si aplica)
   * @param parametros - Configuración del local: papel, márgenes, nombre, etc.
   * @param tipo       - 'interno' para ticket sin datos AFIP, 'factura' para comprobante fiscal
   */
  async generarComprobantePDF(venta: Venta, parametros: ParametrosComprobante, tipo: string): Promise<Buffer> {
    const comprobante = this.mapearComprobante(venta, parametros);
    const resumen     = calcularResumenVenta(venta);

    const docDefinition = tipo === 'interno'
      ? buildDocInterno(comprobante, resumen, venta)
      : buildDocFactura(comprobante, resumen, venta, await this.mapearFactura(venta));

    return generarBufferPDF(docDefinition);
  }

  /**
   * Punto de entrada para PDF de presupuestos — documento simple sin datos fiscales.
   *
   * @param presupuesto - Presupuesto con cliente cargado
   * @param detalles    - Líneas de producto del presupuesto
   * @param parametros  - Configuración del local: papel, márgenes, nombre, etc.
   */
  async generarPresupuestoPDF(presupuesto: Presupuesto, detalles: DetallePresupuesto[], parametros: ParametrosComprobante): Promise<Buffer> {
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
      direccionLocal:   parametros.dirLocal,
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
      direccionLocal:   parametros.dirLocal,
      fechaVenta:       fecha.toLocaleDateString('es-ES'),
      horaVenta:        venta.hora,
      filasTabla:       buildFilasDetalle(venta, configuracionPapel),
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
      clienteReceptor:     venta.cliente?.razonSocial ?? 'Consumidor Final',
      DNI:                 facturaVenta.dni,
      tipoDNI,
      qr:                  await FacturacionServ.ObtenerQRFactura(venta.id),
    };
  }
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
