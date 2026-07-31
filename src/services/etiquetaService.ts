import path from "path";
import PdfPrinter from 'pdfmake';
import { Etiqueta } from "../models/Etiqueta";
import { ProductoImprimir } from "../models/ProductoImprimir";
import { TamaniosEtiqueta } from "../models/EtiquetaTamanios";

const bwipjs = require('bwip-js');

// ─────────────────────────────────────────────────────────────────────────────
// Impresión SILENCIOSA de etiquetas en papel térmico (58mm/80mm).
//
// Por qué esto vive en el backend y no en el front (a diferencia de la generación
// de PDF para A4, que sigue en impresion-etiqueta.service.ts): mandar el PDF al
// diálogo de impresión del navegador (pdfMake.print()) no sirve para rollo térmico.
// El pageSize custom (angosto y bajo) termina "ajustado a hoja" por el driver por
// defecto (letter/A4), lo que lo ve gigante y en vertical. El mismo problema NO pasa
// con tickets/comprobantes porque esos se generan e imprimen acá, server-side, con
// pdf-to-printer y scale:'noscale' (ver filesRoute.ts /imprimir-pdf). Reusamos
// exactamente ese patrón.
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

export class EtiquetaService {

  /** Genera el Buffer del PDF de etiquetas térmicas (58mm/80mm) listo para imprimir. */
  async generarEtiquetasPDF(etiqueta: Etiqueta, productos: ProductoImprimir[]): Promise<Buffer> {
    const docDefinition = await this.armarArchivoTermico(etiqueta, productos);
    return this.generarBufferPDF(docDefinition);
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

  private async armarArchivoTermico(etiqueta: Etiqueta, productos: ProductoImprimir[]) {
    const papel = etiqueta.papel === '80mm' ? '80mm' : '58mm';

    //Rollo continuo: siempre 1 columna, tamaño fijo por ancho de papel. El "tamanio"
    //(GRANDE/MEDIANA/...) de la plantilla no aplica en térmico (ver impresion-etiqueta.service.ts).
    const tarjetasFila = 1;
    const tamanios = this.obtenerTamaniosTermico(papel);

    const cuadritos: any[] = [];

    for (const producto of productos) {
      const codigoBarrasBase64 = etiqueta.mCodigo
        ? await this.generarCodigoBarras(producto.codigo!)
        : null;

      for (let index = 0; index < (producto.cantidad ?? 0); index++) {
        cuadritos.push(this.generarCuadrito(etiqueta, tamanios, producto, codigoBarrasBase64));
      }
    }

    const contenido = this.agruparEnFilas(cuadritos, tarjetasFila);

    //Mismos puntos ya validados en producción para tickets térmicos (ver comprobanteService.ts,
    //CONFIGURACIONES_PAPEL) - no reconvertimos mm a pt a ciegas.
    const anchoPapel = papel === '58mm' ? 140 : 200;

    //Alto dinámico según cantidad total de etiquetas: es rollo continuo, no hoja fija.
    const altoCuadrito = this.estimarAltoCuadrito(etiqueta, tamanios);
    const altoPagina = Math.max(cuadritos.length * altoCuadrito + 10, 60);

    return {
      pageSize: { width: anchoPapel, height: altoPagina },
      content: contenido,
      pageMargins: [4, 6, 4, 0]
    };
  }

  private obtenerTamaniosTermico(papel: string): TamaniosEtiqueta {
    const tamanios = new TamaniosEtiqueta();

    switch (papel) {
      case '58mm':
        tamanios.tarjetaTamanio = 124;
        tamanios.tituloTamanio = 9;
        tamanios.ofertaTamanio = 14;
        tamanios.precioTamanio = 17;
        tamanios.nombreTamanio = 8;
        tamanios.vencimientoTamanio = 7;
        tamanios.codigoTamanio = 100;
        tamanios.codigoTextTamanio = 7;
        tamanios.caracteresNombre = 28;
        break;
      case '80mm':
        tamanios.tarjetaTamanio = 184;
        tamanios.tituloTamanio = 11;
        tamanios.ofertaTamanio = 17;
        tamanios.precioTamanio = 22;
        tamanios.nombreTamanio = 9;
        tamanios.vencimientoTamanio = 8;
        tamanios.codigoTamanio = 145;
        tamanios.codigoTextTamanio = 8;
        tamanios.caracteresNombre = 40;
        break;
    }

    return tamanios;
  }

  private estimarAltoCuadrito(etiqueta: Etiqueta, tamanios: TamaniosEtiqueta): number {
    let alto = 8;

    if (etiqueta.titulo && etiqueta.titulo !== '') alto += tamanios.tituloTamanio + 10;
    if (etiqueta.mOferta) alto += tamanios.ofertaTamanio + 9;
    if (etiqueta.mCodigo) alto += 40 + tamanios.codigoTextTamanio;
    if (etiqueta.mPrecio) alto += tamanios.precioTamanio + 5;
    if (etiqueta.mNombre) alto += tamanios.nombreTamanio + 5;
    if (etiqueta.mVencimiento) alto += tamanios.vencimientoTamanio + 5;

    return alto;
  }

  private agruparEnFilas(array: any[], porFila: number) {
    const filas: any[] = [];

    for (let i = 0; i < array.length; i += porFila) {
      filas.push({ columns: array.slice(i, i + porFila) });
    }

    return filas;
  }

  private generarCuadrito(plantilla: Etiqueta, tamanios: TamaniosEtiqueta, producto: ProductoImprimir, codigoBarra: string | null) {
    return {
      table: {
        widths: [tamanios.tarjetaTamanio],
        body: [[
          {
            stack: [
              ...(plantilla.titulo != '' ? [{
                text: plantilla.titulo,
                color: plantilla.tituloColor,
                alignment: plantilla.tituloAlineacion,
                fontSize: tamanios.tituloTamanio,
                margin: [0, 5, 0, 5]
              }] : []),

              ...(plantilla.mOferta ? [{
                table: {
                  widths: ['*'],
                  body: [[
                    {
                      text: 'OFERTA',
                      color: '#1b1b1b',
                      fillColor: plantilla.ofertaFondo,
                      fontSize: tamanios.ofertaTamanio,
                      alignment: 'center',
                      margin: [0, 2, 0, 2]
                    }
                  ]]
                },
                layout: 'noBorders',
                margin: [0, 0, 0, 5]
              }] : []),

              ...(plantilla.mCodigo && codigoBarra ? [{
                image: codigoBarra,
                height: 40,
                width: tamanios.codigoTamanio,
                alignment: 'center',
                margin: [0, -2, 0, -3]
              }] : []),
              ...(plantilla.mCodigo ? [{
                text: producto.codigo,
                alignment: "center",
                fontSize: tamanios.codigoTextTamanio,
                margin: [0, 0, 0, 5]
              }] : []),

              ...(plantilla.mPrecio ? [{
                text: "$" + this.formatearPrecio(producto.precio),
                alignment: plantilla.precioAlineacion,
                color: plantilla.precioColor,
                fontSize: tamanios.precioTamanio,
                bold: true,
                margin: [0, 0, 0, 5]
              }] : []),

              ...(plantilla.mNombre ? [{
                text: this.cortarNombreProducto(producto.nombre!, tamanios.caracteresNombre),
                alignment: plantilla.nombreAlineacion,
                fontSize: tamanios.nombreTamanio,
                margin: [0, 0, 0, 5]
              }] : []),

              ...(plantilla.mVencimiento ? [{
                text: "Vto: " + producto.vencimiento,
                alignment: plantilla.nombreAlineacion,
                fontSize: tamanios.vencimientoTamanio,
                margin: [0, 0, 0, 5]
              }] : []),
            ],
          }
        ]]
      },
      layout: {
        hLineWidth: () => parseFloat(plantilla.bordeAncho!.replace('px', '')) || 1,
        vLineWidth: () => parseFloat(plantilla.bordeAncho!.replace('px', '')) || 1,
        hLineColor: () => plantilla.bordeColor || 'black',
        vLineColor: () => plantilla.bordeColor || 'black',
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 3,
        paddingBottom: () => 0
      },
      margin: [0, 0, 0, 5]
    };
  }

  private cortarNombreProducto(nombreProd: string, tamanio: number) {
    return nombreProd.length > tamanio ? nombreProd.substring(0, tamanio) + '...' : nombreProd;
  }

  private formatearPrecio(precio: any) {
    const pNumero = parseFloat(precio);
    return pNumero.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  //Código de barras CODE39 generado server-side con bwip-js (pura JS, sin canvas nativo -
  //JsBarcode del front depende del <canvas> del DOM, que no existe en Node).
  private async generarCodigoBarras(texto: string): Promise<string> {
    const png: Buffer = await bwipjs.toBuffer({
      bcid: 'code39',
      text: texto,
      scale: 2,
      height: 12,
      includetext: false,
    });

    return `data:image/png;base64,${png.toString('base64')}`;
  }
}
