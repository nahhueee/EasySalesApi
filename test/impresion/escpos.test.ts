// handoff_impresion_escpos.md CA-05 y CA-06: funciones puras del constructor ESC/POS.
import { armarEscPos, binarizar } from '../../src/services/impresionTermica/escpos';

function bitmapSintetico(ancho: number, alto: number) {
  const pixeles = new Uint8Array(ancho * alto);          // 1 = negro
  pixeles.fill(1, 0, ancho);                              // primera fila toda negra
  return { ancho, alto, pixeles };
}

const FIN = (avance: number) => [0x1B, 0x64, avance, 0x1D, 0x56, 0x42, 0x00];

describe('armarEscPos', () => {
  const salida = armarEscPos(bitmapSintetico(576, 300), { avance: 2 });

  test('CA-05: empieza con ESC @ y termina con avance + corte (GS V 66 0)', () => {
    expect([...salida.subarray(0, 2)]).toEqual([0x1B, 0x40]);
    expect([...salida.subarray(salida.length - 7)]).toEqual(FIN(2));
  });

  test('CA-05: 300 filas => 2 bandas GS v 0 de 256 y 44 filas, xL=72 xH=0', () => {
    expect([...salida.subarray(2, 10)]).toEqual([0x1D, 0x76, 0x30, 0x00, 72, 0, 256 & 255, 256 >> 8]);
    const inicio2 = 2 + 8 + 72 * 256;
    expect([...salida.subarray(inicio2, inicio2 + 8)]).toEqual([0x1D, 0x76, 0x30, 0x00, 72, 0, 44, 0]);
    expect(salida.length).toBe(2 + 8 + 72 * 256 + 8 + 72 * 44 + 7);
  });

  test('CA-05: la primera fila del raster son 72 bytes 0xFF y el resto 0x00', () => {
    const datos = salida.subarray(10, 10 + 72 * 256);
    expect([...datos.subarray(0, 72)].every(b => b === 0xFF)).toBe(true);
    expect([...datos.subarray(72)].every(b => b === 0x00)).toBe(true);
  });

  test('CA-05: con avance 0 termina con ESC d 0 + corte', () => {
    const s = armarEscPos(bitmapSintetico(576, 300), { avance: 0 });
    expect([...s.subarray(s.length - 7)]).toEqual(FIN(0));
  });

  test('CA-05: con ancho 384 las filas miden 48 bytes', () => {
    const s = armarEscPos(bitmapSintetico(384, 10), { avance: 2 });
    expect([...s.subarray(2, 10)]).toEqual([0x1D, 0x76, 0x30, 0x00, 48, 0, 10, 0]);
    expect(s.length).toBe(2 + 8 + 48 * 10 + 7);
  });

  test('el bit más significativo es el pixel de más a la izquierda', () => {
    const pixeles = new Uint8Array(16); pixeles[0] = 1; pixeles[15] = 1;   // 16x1: negro en x=0 y x=15
    const s = armarEscPos({ ancho: 16, alto: 1, pixeles }, { avance: 0 });
    expect([...s.subarray(10, 12)]).toEqual([0x80, 0x01]);
  });
});

describe('binarizar', () => {
  const ancho = 256, alto = 1;
  const gris = new Uint8Array(ancho);
  for (let x = 0; x < ancho; x++) gris[x] = x;            // degradado 0..255
  const negros = (b: { pixeles: Uint8Array }) => b.pixeles.reduce((s, v) => s + v, 0);

  test('CA-06: gris menor que el umbral es negro; igual al umbral es blanco', () => {
    const b = binarizar(gris, ancho, alto, 170);
    expect(b.pixeles[169]).toBe(1);
    expect(b.pixeles[170]).toBe(0);
    expect(b.pixeles[0]).toBe(1);
    expect(b.pixeles[255]).toBe(0);
  });

  test('CA-06: con umbral 170 hay más negros que con 140 (monótono)', () => {
    const a = negros(binarizar(gris, ancho, alto, 140));
    const b = negros(binarizar(gris, ancho, alto, 170));
    expect(a).toBe(140);
    expect(b).toBe(170);
    expect(b).toBeGreaterThan(a);
  });
});
