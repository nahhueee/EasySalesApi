import path from "path";
import PdfPrinter from 'pdfmake';
import { ProductosRepo } from "../data/productosRepository";
import { ParametrosRepo } from "../data/parametrosRepository";
import { Producto } from "../models/Producto";

// ─────────────────────────────────────────────────────────────────────────────
// Export de productos (PR C1, handoff_faltantes_pedido_proveedor.md).
//
// El contrato (POST /productos/exportar) es genérico desde el día uno aunque hoy
// solo exista una plantilla válida ('pedido_proveedor') y un formato ('pdf'). Cuando
// entren "Lista de precios" y "Listado completo" (handoff_filtros_export_productos.md)
// se agregan valores a los arrays de abajo, no se cambia la firma de exportar().
//
// Mecánica de generación de PDF copiada de etiquetaService.ts (PdfPrinter/pdfmake,
// createPdfKitDocument + acumulación de chunks -> Buffer). A diferencia de esa,
// acá es A4 vertical de hoja normal — no hay tamaño de página térmico que calcular.
// ─────────────────────────────────────────────────────────────────────────────

const fonts = {
  Roboto: {
    normal:      path.join(__dirname, '../fonts/Roboto-Regular.ttf'),
    bold:        path.join(__dirname, '../fonts/Roboto-Medium.ttf'),
    italics:     path.join(__dirname, '../fonts/Roboto-Italic.ttf'),
    bolditalics: path.join(__dirname, '../fonts/Roboto-MediumItalic.ttf'),
  },
};

const printer = new PdfPrinter(fonts);

// La API es un proceso Node único que también atiende la caja (§3.5): pdfmake
// generando miles de filas bloquea el event loop y durante ese tiempo no se puede
// cobrar. Tope duro, no configurable desde el front.
export const TOPE_FILAS_EXPORT = 5000;

export class ExportLimiteExcedidoError extends Error {
  constructor(public totalFilas: number) {
    super(`La lista supera los ${TOPE_FILAS_EXPORT} productos. Acotá con filtros antes de exportar.`);
  }
}

const PLANTILLAS_VALIDAS = ['pedido_proveedor'];
const FORMATOS_VALIDOS = ['pdf'];

export class ExportProductosService {

  /**
   * Punto de entrada público. Resuelve los productos según el filtro (sinPaginacion
   * forzado acá, ignorando pagina/tamanioPagina del front — el endpoint es el único
   * dueño de esa decisión) y arma el PDF de la plantilla pedida.
   */
  async exportar(plantilla: string, formato: string, filtro: any): Promise<{ buffer: Buffer, filas: number, duracionMs: number }> {
    if (!PLANTILLAS_VALIDAS.includes(plantilla)) {
      throw new Error(`Plantilla de exportación inválida: "${plantilla}".`);
    }
    if (!FORMATOS_VALIDOS.includes(formato)) {
      throw new Error(`Formato de exportación inválido: "${formato}".`);
    }

    const inicio = Date.now();

    const { total, registros } = await ProductosRepo.Obtener({ ...(filtro ?? {}), sinPaginacion: true });
    if (total > TOPE_FILAS_EXPORT) {
      throw new ExportLimiteExcedidoError(total);
    }

    // 'proveedores' en true/false (string) — mismo parámetro que lee UsaProveedores()
    // en el front (parametros.service.ts). Sin este flag, no hay que agrupar ni mostrar
    // nada de proveedor: sería mostrar una columna/agrupación que la pantalla no tiene.
    const usaProveedores = (await ParametrosRepo.ObtenerParametros('proveedores')) === 'true';
    const parametrosImpresion = await ParametrosRepo.ObtenerParametrosImpresion();

    const buffer = await this.generarPedidoProveedorPDF(registros, filtro ?? {}, usaProveedores, parametrosImpresion);
    const duracionMs = Date.now() - inicio;

    return { buffer, filas: registros.length, duracionMs };
  }

  private generarBufferPDF(documentDefinition: object): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const chunks: Uint8Array[] = [];
        const pdfDoc = printer.createPdfKitDocument(documentDefinition);

        pdfDoc.on('data',  (chunk: Uint8Array) => chunks.push(chunk));
        pdfDoc.on('end',   ()                  => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);

        pdfDoc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  private async generarPedidoProveedorPDF(productos: Producto[], filtro: any, usaProveedores: boolean, parametrosImpresion: any): Promise<Buffer> {
    const fecha = new Date().toLocaleDateString('es-AR');
    const nombreLocal = (parametrosImpresion?.nomLocal ?? '').toString();

    const content: any[] = [
      {
        columns: [
          { text: nombreLocal.toUpperCase(), bold: true, fontSize: 14 },
          { text: fecha, alignment: 'right', fontSize: 10 },
        ],
        margin: [0, 0, 0, 4],
      },
      { text: 'Pedido de reposición', fontSize: 16, bold: true, margin: [0, 0, 0, 2] },
      // Línea de filtros aplicados en texto plano (§3.3) — nadie tiene que descubrir
      // después que el PDF que mandó estaba filtrado por algo que no vio.
      { text: this.descripcionFiltros(filtro, productos), fontSize: 9, color: '#555555', margin: [0, 0, 0, 14] },
    ];

    // Esta plantilla NO incluye costo, precio ni ningún valor monetario, por eso NO
    // necesita gating de rol server-side: expone exactamente lo que la pantalla ya
    // muestra a cualquier usuario que puede abrirla. La PRÓXIMA plantilla que se
    // agregue acá (ej. un pedido valorizado o "Lista de precios") SÍ lo va a
    // necesitar — hoy el costo se oculta solo en el front (main-productos.component.ts
    // arma displayedColumns según rol) y el backend lo devuelve siempre. No asumir
    // que el patrón establecido acá es "no filtrar nada".
    if (usaProveedores) {
      content.push(...this.armarGruposPorProveedor(productos));
    } else {
      content.push(this.armarTablaProductos(productos));
    }

    return this.generarBufferPDF({
      pageSize: 'A4',
      pageMargins: [36, 40, 36, 36],
      content,
      footer: (currentPage: number, pageCount: number) => ({
        text: `Página ${currentPage} de ${pageCount}`,
        alignment: 'center',
        fontSize: 8,
        color: '#888888',
        margin: [0, 6, 0, 0],
      }),
      defaultStyle: { fontSize: 9 },
    });
  }

  private descripcionFiltros(filtro: any, productos: Producto[]): string {
    const partes: string[] = [];

    // El nombre del proveedor no viaja en FiltroProducto (solo idProveedor) — se toma
    // del primer registro resuelto (todos comparten proveedor si el filtro está activo),
    // evitando una consulta extra solo para el texto del encabezado.
    if (filtro?.idProveedor) {
      const nombreProveedor = (productos[0] as any)?.proveedorNombre;
      partes.push(`Proveedor: ${nombreProveedor ?? `#${filtro.idProveedor}`}`);
    }

    if (filtro?.estadoStock === 'sin') partes.push('Estado: Crítico');
    else if (filtro?.estadoStock === 'con') partes.push('Estado: Alerta');

    if (filtro?.sinProveedor) partes.push('Sin proveedor asignado');
    if (filtro?.busqueda) partes.push(`Búsqueda: "${filtro.busqueda}"`);

    return partes.length ? `Filtros: ${partes.join(' · ')}` : 'Todos los faltantes';
  }

  // Agrupado por proveedor, alfabético, con "Sin proveedor" al final (§3.3) — no
  // primero, para no hacer parecer que es el grupo más urgente.
  private armarGruposPorProveedor(productos: Producto[]): any[] {
    const SIN_PROVEEDOR = '__sin_proveedor__';
    const grupos = new Map<string, { telefono?: string, items: Producto[] }>();

    for (const p of productos) {
      const nombre = (p as any).proveedorNombre?.toString().trim() || null;
      const clave = nombre ?? SIN_PROVEEDOR;
      if (!grupos.has(clave)) grupos.set(clave, { telefono: (p as any).proveedorTelefono, items: [] });
      grupos.get(clave)!.items.push(p);
    }

    const nombresConProveedor = [...grupos.keys()]
      .filter(k => k !== SIN_PROVEEDOR)
      .sort((a, b) => a.localeCompare(b, 'es'));
    const claves = grupos.has(SIN_PROVEEDOR) ? [...nombresConProveedor, SIN_PROVEEDOR] : nombresConProveedor;

    const bloques: any[] = [];
    claves.forEach((clave, indice) => {
      const grupo = grupos.get(clave)!;
      const esSinProveedor = clave === SIN_PROVEEDOR;
      const titulo = esSinProveedor ? 'Sin proveedor asignado' : clave;
      const telefono = grupo.telefono ? ` · Tel: ${grupo.telefono}` : '';
      const cantidad = `${grupo.items.length} ${grupo.items.length === 1 ? 'ítem' : 'ítems'}`;

      bloques.push({
        text: `${titulo}${telefono} (${cantidad})`,
        bold: true,
        italics: esSinProveedor,
        fontSize: 11,
        color: esSinProveedor ? '#7a1f1f' : '#000000',
        margin: [0, indice === 0 ? 0 : 14, 0, 4],
      });
      bloques.push(this.armarTablaProductos(grupo.items));
    });

    return bloques;
  }

  private armarTablaProductos(productos: Producto[]): any {
    const filas = productos.map(p => ([
      { text: p.codigo ?? '', fontSize: 9 },
      { text: p.nombre ?? '', fontSize: 9 },
      { text: p.unidad ?? '', fontSize: 9, alignment: 'center' },
      { text: this.formatearCantidad(p.cantidad), fontSize: 9, alignment: 'right' },
      { text: this.formatearCantidad(p.faltante), fontSize: 9, alignment: 'right' },
      // Cantidad a pedir: vacía a propósito (handoff §0.4) — el dueño imprime, camina
      // el depósito y anota. No es una limitación temporal disfrazada: es el flujo real.
      { text: '', fontSize: 9 },
    ]));

    return {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 40, 55, 60, 75],
        body: [
          [
            { text: 'Código', bold: true, fontSize: 9 },
            { text: 'Producto', bold: true, fontSize: 9 },
            { text: 'Unidad', bold: true, fontSize: 9, alignment: 'center' },
            { text: 'Stock actual', bold: true, fontSize: 9, alignment: 'right' },
            { text: 'Punto de pedido', bold: true, fontSize: 9, alignment: 'right' },
            { text: 'Cantidad a pedir', bold: true, fontSize: 9 },
          ],
          ...filas,
        ],
      },
      layout: {
        hLineWidth: (i: number) => i === 1 ? 1 : 0.5,
        // Sin verticales en toda la tabla, salvo alrededor de la última columna
        // ("Cantidad a pedir"): esa se completa a mano al imprimir y necesita un
        // recuadro visible, ancho suficiente para escribir — el resto de la tabla
        // no necesita separadores verticales.
        vLineWidth: (i: number, node: any) => (i === node.table.widths.length - 1 || i === node.table.widths.length) ? 0.75 : 0,
        hLineColor: () => '#cccccc',
        vLineColor: () => '#999999',
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, 0, 0, 4],
    };
  }

  // Los pesables a 3 decimales (20260818120000) hacen que cantidad/faltante puedan
  // no ser enteros — no asumir formato entero acá.
  private formatearCantidad(valor: any): string {
    if (valor == null) return '';
    const n = Number(valor);
    if (Number.isNaN(n)) return String(valor);
    return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, '');
  }
}

export const ExportProductosServ = new ExportProductosService();
