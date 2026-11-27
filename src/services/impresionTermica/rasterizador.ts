// Rasteriza la primera página de un PDF en escala de grises con mupdf (WASM).
// mupdf es ESM y la API compila a CommonJS: se carga con import nativo DIFERIDO (solo en la primera impresión
// ESC/POS). Así una instalación sin la dependencia sigue imprimiendo por driver. NO cambiar tsconfig.

// `new Function` evita que tsc convierta el import() en require() (que no puede cargar un módulo ESM).
const importNativo = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

let mupdfCargado: Promise<any> | null = null;
const cargarMupdf = () => (mupdfCargado ??= importNativo('mupdf').catch((e) => { mupdfCargado = null; throw e; }));

export interface Raster {
  ancho: number;
  alto: number;
  /** 1 byte por pixel (0 = negro, 255 = blanco), `ancho * alto` bytes, sin padding de stride. */
  gris: Uint8Array;
}

/** La página se escala para que su ancho ocupe exactamente `anchoPuntos`. */
export async function rasterizarPDF(pdf: Buffer, anchoPuntos: number): Promise<Raster> {
  const mupdf = await cargarMupdf();
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  const pagina = doc.loadPage(0);
  const [x0, , x1] = pagina.getBounds();
  const escala = anchoPuntos / (x1 - x0);
  const pixmap = pagina.toPixmap(mupdf.Matrix.scale(escala, escala), mupdf.ColorSpace.DeviceGray, false, true);

  const w = pixmap.getWidth();
  const alto = pixmap.getHeight();
  const stride = pixmap.getStride();
  const origen: Uint8Array = pixmap.getPixels();

  // Copia compacta de exactamente `anchoPuntos` columnas (si el redondeo difiere, se recorta o se rellena de blanco).
  const gris = new Uint8Array(anchoPuntos * alto).fill(255);
  const copiar = Math.min(w, anchoPuntos);
  for (let y = 0; y < alto; y++) {
    gris.set(origen.subarray(y * stride, y * stride + copiar), y * anchoPuntos);
  }
  return { ancho: anchoPuntos, alto, gris };
}
