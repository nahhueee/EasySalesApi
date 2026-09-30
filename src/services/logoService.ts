/**
 * Logo del local para comprobantes (Preferencias > Impresión).
 *
 * Se guarda como archivo en la carpeta `upload` (igual que las imágenes de productos) y en la
 * base solo va el NOMBRE (`parametros_impresion.logo`), nunca un path: un path absoluto se rompe
 * al reinstalar, actualizar o mover la carpeta. El nombre lo genera SIEMPRE el server
 * (`logo-<timestamp>.png`), así que también se valida contra ese formato en cada lectura: un
 * nombre que llegue del cliente (guardado o vista previa) no puede apuntar fuera de `upload`.
 *
 * Solo PNG: es lo que pdfmake lee por path junto con JPEG (WebP falla), y el front ya entrega
 * el logo convertido, en escala de grises y de ancho acotado.
 */
import * as fs from 'fs';
import * as path from 'path';
import { uploadPath } from '../conf/upload_config';

export const LOGO_MAX_BYTES = 1024 * 1024;   // 1 MB — un logo optimizado pesa decenas de KB
const LOGO_MAX_LADO_PX = 1200;
const NOMBRE_LOGO = /^logo-\d+\.png$/;
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Todo PNG termina con el chunk IEND (longitud 0 + "IEND" + CRC fijo). Detecta archivos truncados.
const FIN_PNG = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

export function esNombreLogoValido(nombre: unknown): nombre is string {
  return typeof nombre === 'string' && NOMBRE_LOGO.test(nombre);
}

/** Path absoluto del logo si el nombre es válido y el archivo existe y es un PNG; si no, undefined. */
export function rutaLogo(nombre: unknown): string | undefined {
  if (!esNombreLogoValido(nombre)) return undefined;

  const ruta = path.join(path.resolve(uploadPath), nombre);
  try {
    const fd = fs.openSync(ruta, 'r');
    try {
      const tamanio = fs.fstatSync(fd).size;
      if (tamanio < FIRMA_PNG.length + FIN_PNG.length) return undefined;

      const cabecera = Buffer.alloc(FIRMA_PNG.length);
      const final    = Buffer.alloc(FIN_PNG.length);
      fs.readSync(fd, cabecera, 0, cabecera.length, 0);
      fs.readSync(fd, final, 0, final.length, tamanio - final.length);
      return cabecera.equals(FIRMA_PNG) && final.equals(FIN_PNG) ? ruta : undefined;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;   // archivo inexistente/ilegible: el comprobante se imprime sin logo
  }
}

/** Devuelve un mensaje de error si el buffer no es un PNG aceptable, o null si está bien. */
export function validarPNG(buffer: Buffer): string | null {
  if (buffer.length > LOGO_MAX_BYTES) return 'El logo supera 1 MB.';
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(FIRMA_PNG) || !buffer.subarray(-FIN_PNG.length).equals(FIN_PNG)) {
    return 'El logo debe ser una imagen PNG válida.';
  }

  // IHDR: ancho y alto (uint32 big-endian) en los bytes 16-23
  const ancho = buffer.readUInt32BE(16);
  const alto  = buffer.readUInt32BE(20);
  if (!ancho || !alto || ancho > LOGO_MAX_LADO_PX || alto > LOGO_MAX_LADO_PX) {
    return `El logo debe medir como máximo ${LOGO_MAX_LADO_PX}px de ancho y alto.`;
  }
  return null;
}

/** Guarda el PNG ya validado con un nombre generado por el server y devuelve ese nombre. */
export async function guardarLogo(buffer: Buffer): Promise<string> {
  const nombre = `logo-${Date.now()}.png`;
  await fs.promises.writeFile(path.join(path.resolve(uploadPath), nombre), buffer);
  return nombre;
}

/** Borra un logo (best-effort: un archivo que ya no está no es un error). */
export async function eliminarLogo(nombre: unknown): Promise<void> {
  if (!esNombreLogoValido(nombre)) return;
  await fs.promises.unlink(path.join(path.resolve(uploadPath), nombre)).catch(() => undefined);
}
