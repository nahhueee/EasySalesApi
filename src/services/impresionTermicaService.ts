// Fachada de impresión de PDFs en impresoras térmicas. Ver documentos/handoff_impresion_escpos.md §4.
// Único lugar (junto a pdfRoute y etiquetasRoute) que llama al driver (pdf-to-printer).
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import logger from '../logger/loggerGeneral';
import { AppError } from '../logger/AppError';
import { CodigoError } from '../logger/CodigosError';
import { rasterizarPDF } from './impresionTermica/rasterizador';
import { armarEscPos, binarizar } from './impresionTermica/escpos';
import { enviarRaw } from './impresionTermica/envioRaw';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const printer = require('pdf-to-printer');

const MODULO = 'impresionTermicaService';

export class ImpresionTermicaService {

  /**
   * 80mm + modoImpresion ESCPOS => raster ESC/POS directo a la cola (sin fallback al driver si falla).
   * Cualquier otro caso => driver, igual que siempre.
   */
  async imprimirPDF(pdf: Buffer, parametros: any, papelEfectivo: string): Promise<void> {
    if (papelEfectivo === '80mm' && parametros?.modoImpresion === 'ESCPOS') {
      await this.imprimirEscPos(pdf, parametros, papelEfectivo);
      return;
    }
    await this.imprimirConDriver(pdf, parametros);
  }

  private async imprimirConDriver(pdf: Buffer, parametros: any): Promise<void> {
    const carpeta = path.join(__dirname, '..', 'temp');
    fs.mkdirSync(carpeta, { recursive: true });
    const tempPath = path.join(carpeta, `impresion_${uuid()}.pdf`);
    fs.writeFileSync(tempPath, pdf);
    try {
      await printer.print(tempPath, {
        printer: parametros.impresora,
        orientation: 'portrait',
        scale: 'noscale'
      });
    } finally {
      try { fs.unlinkSync(tempPath); } catch { /* ya no está: nada que borrar */ }
    }
  }

  private async imprimirEscPos(pdf: Buffer, parametros: any, papel: string): Promise<void> {
    const impresora = String(parametros.impresora ?? '').trim();
    if (!impresora) {
      throw new AppError(CodigoError.VALIDACION,
        'No hay una impresora configurada. Elegila en Preferencias > Impresión.', 400, { modulo: MODULO });
    }

    const inicio = Date.now();
    try {
      const { ancho, alto, gris } = await rasterizarPDF(pdf, parametros.escposAncho);
      const bitmap = binarizar(gris, ancho, alto, parametros.escposUmbral);
      const bytes = armarEscPos(bitmap, { avance: parametros.escposAvance });
      await enviarRaw(bytes, impresora);
      logger.info(`Impresión ESC/POS: modo=ESCPOS papel=${papel} bytes=${bytes.length} ms=${Date.now() - inicio}`);
    } catch (error: any) {
      logger.error(`Falló la impresión ESC/POS en "${impresora}". ${error?.message ?? error}`);
      throw new AppError(CodigoError.INTERNAL_ERROR,
        `No se pudo imprimir en la impresora configurada (${impresora}). Revisá que esté encendida y conectada.`,
        500, { modulo: MODULO }, error);
    }
  }
}

export const ImpresionTermicaServ = new ImpresionTermicaService();
