import path from "path";
import PdfPrinter from 'pdfmake';
import { ParametrosRepo } from "../data/parametrosRepository";
import { FacturacionServ } from "./facturacionService";
import { Venta } from "../models/Venta";

//#region UTILES
const fonts = {
  Roboto: {
    normal: path.join(__dirname, '../fonts/Roboto-Regular.ttf'),
    bold: path.join(__dirname, '../fonts/Roboto-Medium.ttf'),
    italics: path.join(__dirname, '../fonts/Roboto-Italic.ttf'),
    bolditalics: path.join(__dirname, '../fonts/Roboto-MediumItalic.ttf')
  }
};
const tiposDocumento = [
  { id: 80, descripcion: 'CUIT' },
  { id: 86, descripcion: 'CUIL' },
  { id: 96, descripcion: 'DNI' }
];
const condicionesIVAReceptor = [
  { id: 5, descripcion: 'Consumidor Final' },
  { id: 1, descripcion: 'IVA Responsable Inscripto' },
  { id: 6, descripcion: 'Responsable Monotributo' },
  { id: 13, descripcion: 'Monotributista Social' },
  { id: 15, descripcion: 'IVA No Alcanzado' }
];

interface PaperConfig {
  pageSize:     any;
  fontSizes:    { titulo: number; normal: number; tabla: number; total: number };
  marginTop:    number;
  tableMargin:  number[];
  maxChars:     number;
  decimales:    number;
  cantDecimals: number;
  qrWidth:      number;
}
//#endregion

const printer = new PdfPrinter(fonts);

/**
 * ComprobanteService
 * -----------------
 * Genera comprobantes internos y facturas AFIP en PDF usando pdfmake.
 * Soporta tres formatos de papel: 58mm, 80mm y A4.
 *
 * Flujo principal:
 *   GenerarComprobantePDF(venta, parametros, tipo)
 *     ├─ 'interno'  → buildInterno()
 *     └─ 'factura'  → mapearFactura() 
 *        └─ buildFacturaTermica()
 *        └─ buildFacturaA4()
 */

//#region CONFIGURACIÓN POR PAPEL
/**
 * Define las propiedades visuales y de layout para cada tamaño de papel.
 * Agregar nuevos formatos aquí sin tocar el resto del código.
 */
const PAPER_CONFIGS: Record<string, PaperConfig> = {
  '58mm': {
    pageSize:    { width: 140, height: 800 },
    fontSizes:   { titulo: 11, normal: 7, tabla: 6.5, total: 9 },
    marginTop:   1,
    tableMargin: [0, 3, 0, 2],
    maxChars:    25,   // caracteres máx. por línea en col. "Producto"
    decimales:   1,    // un decimal en precios
    cantDecimals: 0,   // cantidades sin decimal (ej: "2" no "2.00")
    qrWidth: 100       // tamaño del qr
  },

  '80mm': {
    pageSize:    { width: 200, height: 800 },
    fontSizes:   { titulo: 14, normal: 10, tabla: 8.5, total: 12 },
    marginTop:   2,
    tableMargin: [0, 4, 0, 2],
    maxChars:    35,
    decimales:   1,
    cantDecimals: 1,
    qrWidth: 120
  },

  'A4': {
    pageSize:    'A4',
    fontSizes:   { titulo: 16, normal: 12, tabla: 11, total: 15 },
    marginTop:   10,
    tableMargin: [0, 10, 0, 10],
    maxChars:    999, // sin límite: el texto puede ocupar varias líneas
    decimales:   2,
    cantDecimals: 2,
    qrWidth: 150
  },
};
//#endregion

//#region HELPERS DE FORMATO
/**
 * Formatea un número como moneda argentina.
 * En tickets chicos (58mm / 80mm) usa 1 decimal para ahorrar espacio.
 */
function formatMoney(value: number, cfg: PaperConfig): string {
  return value.toLocaleString('es-AR', {
    minimumFractionDigits: cfg.decimales,
    maximumFractionDigits: cfg.decimales,
  });
}

/**
 * Formatea una cantidad.
 * En impresoras térmicas muestra sin decimales (ej: "3"), en A4 con decimales.
 */
function formatCantidad(value: number, cfg: PaperConfig): string {
  const num = Number(value);
  return num.toLocaleString('es-AR', {
    minimumFractionDigits: cfg.cantDecimals,
    maximumFractionDigits: cfg.cantDecimals,
  });
}

/**
 * Corta un texto para que no supere `maxChars` caracteres.
 * Respeta palabras completas siempre que sea posible.
 * Si una sola palabra ya supera el límite, corta con "…".
 *
 * NOTA: Este era el bug original — la función recibía el objeto cfg completo
 * pero se llamaba con `cfg.chars` (undefined). Ahora recibe PaperConfig.
 */
function truncarTexto(texto: string, cfg: PaperConfig): string {
  if (!texto) return '';

  const max = cfg.maxChars;
  if (texto.length <= max) return texto;

  // Intentar cortar en límite de palabra
  const palabras = texto.split(' ');
  let resultado   = '';

  for (const palabra of palabras) {
    const tentativa = resultado ? `${resultado} ${palabra}` : palabra;
    if (tentativa.length <= max) {
      resultado = tentativa;
    } else {
      break;
    }
  }

  // Fallback: una sola palabra ya excede el límite
  if (!resultado) {
    return texto.substring(0, max - 1) + '…';
  }

  return resultado + '…';
}

/** Celda genérica — convierte cualquier valor a string y aplica opciones extras */
function cell(text: any, opts: object = {}): object {
  return { text: String(text ?? ''), ...opts };
}

/**
 * Fila de texto alineada a la derecha, usada para subtotal / total / deuda.
 * El parámetro `type` aplica estilos predefinidos (total, descuento, recargo, deuda).
 */
function rowRight(text: string, cfg: PaperConfig, type?: 'total' | 'descuento' | 'recargo' | 'deuda'): object {
  const estilos = {
    total:    { bold: true, fontSize: cfg.fontSizes.total },
    descuento:{ color: 'green' },
    recargo:  { color: 'red' },
    deuda:    { bold: true },
  };

  return {
    text,
    alignment: 'right',
    margin:    [0, 1, 0, 1],
    fontSize:  cfg.fontSizes.normal,
    ...(type ? estilos[type] : {}),
  };
}

/** Par "Label: valor" en una línea, reutilizable en todo el A4 */
function labelValor(label: string, valor: any, bold = false): object {
  return {
    text: [
      { text: `${label}: `, bold: true },
      { text: String(valor ?? '—'), bold },
    ],
    fontSize: 10,
    margin: [8, 0, 0, 4],
  };
}

/** Layout de líneas gris claro, reutilizado en todas las tablas del A4 */
function lineLayout() {
  return {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#aaaaaa',
    vLineColor: () => '#aaaaaa',
  };
}

/** Texto resumen del pago para la sección receptor */
function buildPagoTexto(venta: any): string {
  if (!venta.detallePago?.length) return '—';
  return venta.detallePago
    .map((d: any) => `${d.tipoPago.nombre}: $${d.monto.toLocaleString('es-AR')}`)
    .join('  |  ');
}
//#endregion


// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTORES DE SECCIONES DEL DOCUMENTO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encabezado del comprobante interno (nombre local, descripción, dirección, fecha).
 * En A4 usa layout de dos columnas; en tickets térmicos, apilado centrado.
 */
function buildHeader(comp: any, cfg: PaperConfig, esFactura: boolean = false): object {
  if (comp.papel === 'A4') {
    return {
      columns: [
        { text: comp.nombreLocal?.toUpperCase(), bold: true, fontSize: cfg.fontSizes.titulo },
        { text: `${comp.fechaVenta} ${comp.horaVenta}`, alignment: 'right', fontSize: cfg.fontSizes.normal },
      ],
      margin: [0, 0, 0, cfg.marginTop],
    };
  }

  // Solo incluir las filas que tienen contenido
  const filas = [
    { text: comp.nombreLocal?.toUpperCase(), alignment: 'center', fontSize: cfg.fontSizes.titulo, bold: true },
    comp.desLocal?.trim() ? { text: comp.desLocal, alignment: 'center', fontSize: cfg.fontSizes.normal } : null,
    
    // Solo mostrar dirección si NO es factura
    (!esFactura && comp.dirLocal?.trim())
      ? { text: comp.dirLocal, alignment: 'center', fontSize: cfg.fontSizes.normal } : null,

    {
      text:      `${comp.fechaVenta} ${comp.horaVenta}`,
      alignment: 'center',
      fontSize:  cfg.fontSizes.normal,
      margin:    [0, cfg.marginTop, 0, cfg.marginTop],
    },
  ];

  return filas.filter(Boolean);
}

/**
 * Muestra el nombre del cliente y los métodos de pago utilizados.
 * Soporta pago simple y combinado (múltiples entradas en detallePago).
 * Si no hay cliente o no hay detalle de pago, omite esa línea.
 */
function buildClienteYPago(venta: any, cfg: PaperConfig): object[] {
  const filas: object[] = [];

  // Nombre del cliente (si existe)
  if (venta.cliente?.nombre?.trim()) {
    filas.push({
      text:      `Cliente: ${venta.cliente.nombre}`,
      fontSize:  cfg.fontSizes.normal,
      margin:    [0, 2, 0, 0],
    });
  }

  // Métodos de pago — puede ser uno o varios (pago combinado)
  if (venta.detallePago?.length) {
    const pagos = venta.detallePago
      .map((d: any) => `${d.tipoPago.nombre}: $${formatMoney(d.monto, cfg)}`)
      .join('  |  ');

    filas.push({
      text:     `Pago: ${pagos}`,
      fontSize: cfg.fontSizes.normal,
      margin:   [0, 0, 0, 2],
    });
  }

  return filas;
}

/**
 * Encabezado de factura AFIP: tipo (A/B/C), datos del emisor y receptor.
 */

function buildFacturaHeader(comprobante: any, factura: any, config: PaperConfig): object[] {
  const filas: object[] = [];

  const tipoMap: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };
  const desComprobante = tipoMap[factura.tipoComprobante] ?? 'X';

  // ── Tipo de comprobante (A / B / C) ──────────────────────────────────────
  filas.push({
    columns: [
      { width: '*', text: '' }, // espacio izquierdo

      {
        width: 'auto',
        table: {
          body: [
            [
              {
                stack: [
                  {
                    text: desComprobante,
                    alignment: 'center',
                    bold: true,
                    fontSize: config.fontSizes.titulo + 4
                  },
                  {
                    text: `Cod:${factura.tipoComprobante}`,
                    alignment: 'center',
                    fontSize: config.fontSizes.normal - 2
                  }
                ],
                margin: [5, 0, 5, 0]
              }
            ]
          ]
        },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5
        }
      },

      { width: '*', text: '' } // espacio derecho
    ],
    margin: [0, 0, 0, 5]
  });

  // ── Datos del local ───────────────────────────────────────────────────────
  filas.push(buildHeader(comprobante, config, true))

  // ── Datos del emisor ──────────────────────────────────────────────────────
  filas.push(
    {
      canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }],
      margin: [0, 3, 0, 3]
    },
    { text: factura.condicion, alignment: 'center', bold: true, fontSize: config.fontSizes.normal, margin: [0, 3, 0, 0]},
  );
  filas.push({
    text:      `${factura.CUIL}`,
    alignment: 'center',
    fontSize:  config.fontSizes.normal
  });

  // Razón social y dirección: solo si tienen contenido
  if (factura.razon?.trim()) {
    filas.push({ text: factura.razon, alignment: 'center', fontSize: config.fontSizes.normal - 1 });
  }
  if (factura.direccion?.trim()) {
    filas.push({ text: factura.direccion, alignment: 'center', fontSize: config.fontSizes.normal - 1, margin: [0, 0, 0, 2] });
  }

  // ── Número de comprobante ─────────────────────────────────────────────────
  filas.push({
    text: `Ticket Nro: ${String(factura.puntoVta).padStart(4, '0')}-${String(factura.ticket).padStart(8, '0')}`, alignment: 'center',
    bold: true,
    fontSize: config.fontSizes.normal,
    margin: [0, 0, 0, 2],
  },
  {
    canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5 }],
    margin: [0, 3, 0, 3]
  },
);

  // ── Datos del receptor — en 58mm va en una sola línea compacta ────────────
  const dni    = factura.DNI    ? `${factura.tipoDNI}: ${factura.DNI}` : '';
  const receptor = [dni, factura.condReceptor].filter(Boolean).join('  |  ');

  if (receptor) {
    filas.push({ text: 'Receptor', alignment: 'center', bold:true, fontSize: config.fontSizes.normal - 1});
    filas.push({
      text:      receptor,
      alignment: 'center',
      fontSize:  config.fontSizes.normal - 1,
      margin:    [0, 0, 0, 2],
    });
  }

  return filas;
}

/**
 * Tabla de productos.
 * Las columnas son: C (cantidad) | Producto | Precio unit. | Total
 */
function buildTabla(comp: any, cfg: PaperConfig): object {
  // Encabezado
  const body: any[][] = [[
    cell('C',        { style: 'th' }),
    cell('Producto', { style: 'th' }),
    cell('P.Unit',   { style: 'th', alignment: 'right' }),
    cell('Total',    { style: 'th', alignment: 'right' }),
  ]];

  for (const item of comp.filasTabla) {
    body.push(item); // las filas ya se construyen en buildFilasDetalle()
  }

  return {
    table: {
      widths: ['auto', '*', 'auto', 'auto'],
      body,
    },
    layout: {
      fillColor:     (row: number) => (row === 0 ? '#eeeeee' : null),
      hLineWidth:    (i: number, node: any) =>
        (i === 1 || i === node.table.body.length) ? 0.5 : 0,
      vLineWidth:    () => 0,
      paddingTop:    () => 1,
      paddingBottom: () => 1,
    },
    margin:     cfg.tableMargin,
    fontSize:   cfg.fontSizes.tabla,
    lineHeight: 1,
  };
}

/**
 * Construye las filas de detalle (sin el encabezado) para la tabla de productos.
 * Separado de buildTabla para mantener cada función con una única responsabilidad.
 */
function buildFilasDetalle(venta: any, cfg: PaperConfig): any[][] {
  return venta.detalles.map((item: any) => [
    cell(formatCantidad(item.cantidad, cfg), { alignment: 'center' }),
    cell(truncarTexto(item.nomProd, cfg)),
    cell(formatMoney(item.precio, cfg), { alignment: 'right' }),
    cell(formatMoney(item.total, cfg),  { alignment: 'right' }),
  ]);
}

/**
 * Bloque de totales: subtotal → ajuste (desc/recargo) → TOTAL → deuda.
 * Solo muestra las filas que aplican según el resumen.
 */
function buildTotales(resumen: any, cfg: PaperConfig): object[] {
  if (!resumen) return [];

  const rows: object[] = [];

  // Mostrar subtotal solo si hay algún modificador que lo haga relevante
  const tieneModificador = resumen.montoAjuste > 0;
  if (tieneModificador) {
    rows.push(rowRight(`Subtotal: $${formatMoney(resumen.subtotal, cfg)}`, cfg));

    const esDesc     = resumen.tipo === 'descuento';
    const signo      = esDesc ? '-' : '+';
    const label      = esDesc ? 'Descuento' : 'Recargo';
    const porcentaje = resumen.porcentaje ? ` (${resumen.porcentaje.toFixed(2)}%)` : '';

    rows.push(rowRight(
      `${label}${porcentaje}: ${signo}$${formatMoney(resumen.montoAjuste, cfg)}`,
      cfg,
      resumen.tipo,
    ));
  }

  rows.push(rowRight(`TOTAL: $${formatMoney(resumen.total, cfg)}`, cfg, 'total'));

  if (resumen.tieneDeuda) {
    rows.push(
      rowRight(`Entregado: $${formatMoney(resumen.entregado, cfg)}`, cfg),
      rowRight(`Debe:      $${formatMoney(resumen.restante,  cfg)}`, cfg, 'deuda'),
    );
  }

  return rows;
}

/**
 * Desglose de IVA — solo para facturas tipo A y B (no monotributo).
 */
function buildIVA(f: any, cfg: PaperConfig): object[] {
  if (f.tipoComprobante === 11) return []; // Tipo C: monotributo, sin IVA

  const esA4 = cfg.pageSize === 'A4';


  return [
    { text: 'IVA 21% Incluido', alignment: esA4 ? 'right' : 'center', margin: [0, 5, 0, 3], fontSize: cfg.fontSizes.normal },
    rowRight(`NETO: $${formatMoney(f.neto, cfg)}`, cfg),
    rowRight(`IVA:  $${formatMoney(f.iva, cfg)}`, cfg),
  ];
}

/**
 * Bloque del CAE (código de autorización electrónica) de AFIP.
 */
function buildCAE(f: any, cfg: PaperConfig): object {
  return {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'CAE',    alignment: 'center', bold: true,  fontSize: cfg.fontSizes.normal },
          { text: f.cae,    alignment: 'center',              fontSize: cfg.fontSizes.normal },
          { text: f.caeVto, alignment: 'center',              fontSize: cfg.fontSizes.normal },
        ],
      }]],
    },
    layout: 'noBorders',
    margin: [0, 3, 0, 3],
  };
}

/** QR de verificación AFIP */
function buildQR(f: any, cfg: PaperConfig): object {
  return {
    image:     f.qr,
    width:     cfg.qrWidth,
    alignment: 'center',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTRUCTORES DE DOCUMENTO COMPLETO
// ─────────────────────────────────────────────────────────────────────────────

function buildDocInterno(comp: any, resumen: any, venta:Venta): object {
  const cfg = getPaperConfig(comp.papel);

  return {
    pageSize: cfg.pageSize,
    pageMargins: comp.papel === 'A4'
    ? [
        comp.margenIzq || 15,
        15,
        comp.margenDer || 15,
        15
      ]
    : [
        comp.margenIzq,
        4,
        comp.margenDer,
        4
      ],

    content: [
      buildHeader(comp, cfg),
      ...buildClienteYPago(venta, cfg),  
      buildTabla(comp, cfg),
      ...buildTotales(resumen, cfg),
    ],
  };
}

function buildDocFactura(comprobante: any, resumen: any, venta:Venta, factura: any): object {
  const cfg = getPaperConfig(comprobante.papel);

  // A4 tiene su propio layout profesional
  if (comprobante.papel === 'A4') {
    return buildDocFacturaA4(comprobante, resumen, venta, factura);
  }

  // 58mm / 80mm — layout compacto para tickets térmicos
  return {
    pageSize:    cfg.pageSize,
    pageMargins: [comprobante.margenIzq, 4, comprobante.margenDer, 4],
 
    content: [
      ...buildFacturaHeader(comprobante, factura, cfg),  
      buildTabla(comprobante, cfg),
      ...buildTotales(resumen, cfg),
      ...buildIVA(factura, cfg),
      buildCAE(factura, cfg),                    
      buildQR(factura, cfg),
    ],
  };
}

/**
 * Layout profesional para factura A4.
 * Estructura:
 *   1. Header 3 columnas: datos emisor | tipo comprobante | datos del documento
 *   2. Datos del receptor
 *   3. Tabla de productos
 *   4. Totales
 *   5. Pie: QR + CAE + IVA
 */
function buildDocFacturaA4(comp: any, resumen: any, venta: Venta, f: any): object {
  console.log(f.tipoComprobante)
  const tipoMap: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };
  const desComprobante = tipoMap[f.tipoComprobante] ?? 'X';
  console.log(desComprobante)

  // ── 1. Header tres columnas ───────────────────────────────────────────────
  const headerTable = {
    table: {
      widths: ['45%', '10%', '45%'],
      body: [[
        // Columna izquierda — datos del emisor
        {
          stack: [
            { text: comp.nombreLocal?.toUpperCase(), fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
            labelValor('Dirección',           f.direccion),
            labelValor('Cond. IVA',           f.condicion),
            labelValor('CUIT',                f.CUIL),
            labelValor('Razón Social',    f.razon),
          ]
        },
        // Columna central — letra del comprobante
        {
          stack: [
            { text: desComprobante, fontSize: 25, bold: true, decoration: 'underline', alignment: 'center', margin: [0, 10, 0, 3] },
            { text: `Cod. ${f.tipoComprobante}`, fontSize: 7, alignment: 'center' },
          ],
          alignment: 'center'
        },
        // Columna derecha — datos del documento
        {
          stack: [
            { text: 'FACTURA', fontSize: 14, bold: true, alignment: 'center', margin: [0, 10, 0, 8] },
            labelValor('Nro Comp',        `${f.puntoVta?.toString().padStart(4, '0')} - ${f.ticket?.toString().padStart(8, '0')}`, true),
            labelValor('Fecha Emisión',   `${comp.fechaVenta} - ${comp.horaVenta}`),
          ]
        },
      ]],
    },
    layout: lineLayout(),
  };

  // ── 2. Datos del receptor ─────────────────────────────────────────────────
  const receptorTable = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          labelValor('Cliente',              venta.cliente?.nombre ?? 'Consumidor Final'),
          labelValor('Condición',            f.condReceptor),
          labelValor(`${f.tipoDNI}`,         f.DNI),
          labelValor('Método de pago',       buildPagoTexto(venta)),
        ],
        margin: [8, 4, 8, 4],
      }]],
    },
    layout: {
      fillColor: () => '#eeeeee',
      ...lineLayout(),
    },
    margin: [0, 10, 0, 10],
  };

  // ── 3. Tabla de productos ─────────────────────────────────────────────────
  const tablaProductos = buildTabla(comp, getPaperConfig('A4'));

  // ── 4. Totales ────────────────────────────────────────────────────────────
  const cfgA4 = getPaperConfig('A4');
  const totalesTable = {
    table: {
      widths: ['50%', '50%'],
      body: [[
        // Izquierda — leyenda fiscal si aplica
        {
          // stack: [
          //   f.tipoComprobante === 6 ? {
          //     text: 'El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618',
          //     italics: true,
          //     fontSize: 9,
          //     margin: [5, 5, 5, 5],
          //   } : { text: '' },
          // ]
        },
        // Derecha — números
        {
          stack: [
            ...buildTotales(resumen, cfgA4),
            ...buildIVA(f, cfgA4),
          ]
        },
      ]],
    },
    layout: lineLayout(),
    margin: [0, 10, 0, 0],
  };

  // ── 5. Pie — QR + CAE + IVA ───────────────────────────────────────────────
  const pie = {
    columns: [
      // QR
      { image: f.qr, width: 100, alignment: 'left', margin: [0, 0, 30, 0] },

      // CAE
      {
        stack: [
          { text: 'Comprobante Autorizado', fontSize: 10, italic: true, bold: true, margin: [8, 3, 0, 10] },
          labelValor('CAE',             f.cae),
          labelValor('Vencimiento CAE', f.caeVto),
          labelValor('Moneda', 'PES'),
        ],
        width: 'auto',
      },

      // IVA — solo para A y B
      // f.tipoComprobante !== 11
      //   ? {
      //       stack: [
      //         { text: f.tipoComprobante === 6 ? 'IVA 21% Incluido' : 'IVA 21% Discriminado', fontSize: 10, margin: [0, 0, 0, 5] },
      //         labelValor('Neto', `$${formatMoney(Number(f.neto), cfgA4)}`),
      //         labelValor('IVA',  `$${formatMoney(Number(f.iva),  cfgA4)}`),
      //         labelValor('Moneda', 'PES'),
      //       ],
      //       alignment: 'right',
      //       width: '*',
      //     }
      //   : { text: '', width: '*' },
      ],
    margin: [0, 15, 0, 0],
  };

  return {
    pageSize:    'A4',
    pageOrientation: 'portrait',
    pageMargins: [10, 10, 10, 10],
    content:     [headerTable, receptorTable, tablaProductos, totalesTable, pie],
    styles:      a4Styles(getPaperConfig('A4')),
  };
}
function a4Styles(cfg: PaperConfig): object {
  return {
    simple:           { fontSize: cfg.fontSizes.normal,  margin: [8, 0, 0, 4] },
    titulo:           { fontSize: cfg.fontSizes.titulo,  bold: true, margin: [0, 15, 0, 8] },
    tipoComprobante:  { fontSize: cfg.fontSizes.titulo + 10, bold: true, decoration: 'underline', margin: [0, 10, 0, 3] },
    tableStyle:       { fontSize: cfg.fontSizes.tabla,   margin: [0, 0, 0, 5] },
    totalProducto:    { fontSize: cfg.fontSizes.normal,  margin: [3, 1, 3, 1] },
    subtotal:         { fontSize: cfg.fontSizes.normal,  margin: [3, 12, 3, 1] },
    descuento:        { fontSize: cfg.fontSizes.normal,  margin: [3, 1, 3, 1] },
    total:            { fontSize: cfg.fontSizes.total,   bold: true, margin: [3, 10, 3, 5] },
    recargaDescuento: { fontSize: cfg.fontSizes.normal,  margin: [3, 1, 3, 1] },
    totales:          { margin: [0, 10, 0, 0] },
    leyenda:          { fontSize: cfg.fontSizes.normal - 2, italics: true, margin: [5, 5, 5, 5] },
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// SERVICIO PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export class ComprobanteService {

  // ── Punto de entrada público ──────────────────────────────────────────────

  async GenerarComprobantePDF(venta: Venta, parametros: any, tipo: string): Promise<Buffer> {
    const comprobante = this.mapearComprobante(venta, parametros);
    const resumen = calcularResumenVenta(venta);



    const docDefinition = tipo === 'interno'
      ? buildDocInterno(comprobante, resumen, venta)
      : buildDocFactura(comprobante, resumen, venta, await this.mapearFactura(venta));

    return generarBufferPDF(docDefinition);
  }

  // ── Mapeo de datos ────────────────────────────────────────────────────────

  /**
   * Normaliza la venta + parámetros en un objeto `comp` listo para los builders.
   */
  private mapearComprobante(venta: any, params: any): any {
    const cfg   = getPaperConfig(params.papel);
    const fecha = new Date(venta.fecha);

    return {
      papel:       params.papel,
      margenIzq:   params.margenIzq,
      margenDer:   params.margenDer,
      nombreLocal: params.nomLocal,
      desLocal:    params.desLocal,
      dirLocal:    params.dirLocal,
      fechaVenta:  fecha.toLocaleDateString('es-ES'),
      horaVenta:   venta.hora,

      // Se construyen las filas aquí para tener el cfg disponible
      filasTabla: buildFilasDetalle(venta, cfg),
    };
  }

  /** Reúne los datos de factura AFIP desde la venta y los parámetros del sistema. */
  private async mapearFactura(venta: any): Promise<any> {
    const factura    = venta.factura;
    const parametros = await ParametrosRepo.ObtenerParametrosFacturacion();

    const tipoMap: Record<number, string> = { 1: 'A', 6: 'B', 11: 'C' };
    const tipoDocDesc = tiposDocumento.find(t => t.id === factura.tipoDni)?.descripcion;
    const tipoCondicionDesc = condicionesIVAReceptor.find(t => t.id === factura.condReceptor)?.descripcion;
    
    return {
      puntoVta:          factura?.ptoVenta,
      ticket:            factura?.ticket,
      neto:              factura?.neto,
      iva:               factura?.iva,
      cae:               factura?.cae,
      caeVto:            new Date(factura?.caeVto).toLocaleDateString('es-AR'),
      tipoComprobante:   factura?.tipoFactura,
      desTipoComprobante: tipoMap[factura?.tipoFactura] ?? '',
      condicion:         parametros.condicion === 'responsable_inscripto'
                           ? 'RESPONSABLE INSCRIPTO'
                           : 'MONOTRIBUTISTA',
      razon:             parametros.razon,
      direccion:         parametros.direccion,
      CUIL:              parametros.cuil,
      condReceptor:      tipoCondicionDesc,
      DNI:               factura?.dni,
      tipoDNI:           tipoDocDesc,
      qr:                await FacturacionServ.ObtenerQRFactura(venta.id),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES INTERNAS
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve la config del papel solicitado, con fallback a 80mm. */
function getPaperConfig(papel: string): PaperConfig {
  return PAPER_CONFIGS[papel] ?? PAPER_CONFIGS['80mm'];
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

function calcularResumenVenta(venta: any) {
  const pago = venta?.pago;
  if (!pago) return null;

  const subtotal = pago.monto ?? 0;
  const descuento = pago.descuento ?? 0;
  const recargo = pago.recargo ?? 0;

  const tipo = descuento > 0 ? 'descuento' : recargo > 0 ? 'recargo' : null;

  let montoAjuste = 0;
  let porcentaje: number | null = null;

  if (tipo) {
    const valor = tipo === 'descuento' ? descuento : recargo;

    if (pago.tipoModificador === 'porcentaje') {
      porcentaje = valor;
      montoAjuste = subtotal * (valor / 100);
    } else {
      montoAjuste = valor;
    }
  }

  const total = venta.total ?? subtotal;
  const entregado = pago.entrega ?? 0;
  const restante = pago.restante ?? 0;
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
    totalMostrar: tieneDeuda ? restante : total
  };
}

// export default new ComprobanteService();
