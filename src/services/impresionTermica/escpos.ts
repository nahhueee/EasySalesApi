// ESC/POS: funciones puras, sin I/O. Ver documentos/handoff_impresion_escpos.md §4.

/** Imagen de 1 bit por pixel (guardada como 1 byte por pixel): 1 = negro, 0 = blanco. */
export interface Bitmap1bit {
  ancho: number;
  alto: number;
  pixeles: Uint8Array;
}

const FILAS_POR_BANDA = 256;

/** gris < umbral => negro. Un gris igual al umbral es blanco. */
export function binarizar(gris: Uint8Array, ancho: number, alto: number, umbral: number): Bitmap1bit {
  const pixeles = new Uint8Array(ancho * alto);
  for (let i = 0; i < pixeles.length; i++) pixeles[i] = gris[i] < umbral ? 1 : 0;
  return { ancho, alto, pixeles };
}

/**
 * ESC @ · bandas de 256 filas como GS v 0 (bit más significativo = pixel de más a la izquierda, 1 = negro)
 * · ESC d n (avance) · GS V 66 0 (avanza hasta la cuchilla y corta).
 */
export function armarEscPos(bitmap: Bitmap1bit, opciones: { avance: number }): Buffer {
  const { ancho, alto, pixeles } = bitmap;
  if (ancho % 8 !== 0) throw new Error(`El ancho del raster debe ser múltiplo de 8 (recibido ${ancho}).`);
  const bytesPorFila = ancho / 8;

  const partes: Buffer[] = [Buffer.from([0x1B, 0x40])];                              // ESC @
  for (let y = 0; y < alto; y += FILAS_POR_BANDA) {
    const filas = Math.min(FILAS_POR_BANDA, alto - y);
    const datos = Buffer.alloc(bytesPorFila * filas);
    for (let r = 0; r < filas; r++) {
      const base = (y + r) * ancho;
      for (let x = 0; x < ancho; x++) {
        if (pixeles[base + x]) datos[r * bytesPorFila + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    partes.push(
      Buffer.from([0x1D, 0x76, 0x30, 0x00, bytesPorFila & 255, bytesPorFila >> 8, filas & 255, filas >> 8]), // GS v 0 m xL xH yL yH
      datos,
    );
  }
  partes.push(Buffer.from([0x1B, 0x64, opciones.avance & 255]));                     // ESC d n
  partes.push(Buffer.from([0x1D, 0x56, 0x42, 0x00]));                                // GS V 66 0
  return Buffer.concat(partes);
}
