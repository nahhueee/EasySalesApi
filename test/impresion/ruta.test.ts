// handoff_impresion_escpos.md CA-07 a CA-12: ruteo ESC/POS vs driver en POST /files/imprimir-resumen-caja.
// La impresión real NUNCA corre: pdf-to-printer, child_process.execFile y el rasterizador están mockeados.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { api, crearPedido } from '../helpers/api';
import { q, q1, cerrarDb } from '../helpers/db';
import { IDS } from '../helpers/ids';

const mockPrint = jest.fn();
jest.mock('pdf-to-printer', () => ({ print: (...a: any[]) => mockPrint(...a) }));

const mockRasterizar = jest.fn();
jest.mock('../../src/services/impresionTermica/rasterizador', () => ({
  rasterizarPDF: (...a: any[]) => mockRasterizar(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const cp = require('child_process');

const IMPRESORA = 'TEST-PRINTER';
const FIN_AVANCE_2 = [0x1B, 0x64, 0x02, 0x1D, 0x56, 0x42, 0x00];

const configurar = (body: any) =>
  api.post('/parametros/actualizar-impresion', { impresora: IMPRESORA, papel: '80mm', ...body });
const imprimir = (body: any = { idCaja: IDS.cajaAbierta }) => api.post('/files/imprimir-resumen-caja', body);
const binesImpresion = () => fs.readdirSync(os.tmpdir()).filter(f => /^easysales_escpos_.*\.bin$/.test(f)).sort();

/** execFile falso: captura el .bin de -Archivo ANTES de llamar al callback (el servicio lo borra después). */
function espiarExecFile(error?: Error) {
  const capturas: { file: string; args: string[]; ruta: string; bytes: Buffer }[] = [];
  const espia = jest.spyOn(cp, 'execFile').mockImplementation((...a: any[]) => {
    const file = a[0] as string; const args = a[1] as string[];
    const cb = a.find(x => typeof x === 'function');
    const ruta = args[args.indexOf('-Archivo') + 1];
    capturas.push({ file, args, ruta, bytes: fs.readFileSync(ruta) });
    cb(error ?? null, 'OK', '');
    return {} as any;
  });
  return { espia, capturas };
}

function mockRaster400() {
  const gris = new Uint8Array(576 * 400).fill(255);
  gris.fill(0, 0, 576);                                   // fila 0 negra
  mockRasterizar.mockResolvedValue({ ancho: 576, alto: 400, gris });
}

let original: any;
beforeAll(async () => {
  original = await q1<any>('SELECT impresora, papel, modoImpresion, escposUmbral, escposAvance, escposAncho FROM parametros_impresion');
});
afterAll(async () => {
  await q('UPDATE parametros_impresion SET impresora = ?, papel = ?, modoImpresion = ?, escposUmbral = ?, escposAvance = ?, escposAncho = ?',
    [original.impresora, original.papel, original.modoImpresion, original.escposUmbral, original.escposAvance, original.escposAncho]);
  // El afterAll global (test/setup/afterEnv.ts) corre ANTES que este y ya cerró el pool; q() lo
  // reabre, así que hay que volver a cerrarlo o Jest queda colgado.
  await cerrarDb();
});
beforeEach(() => { mockPrint.mockReset().mockResolvedValue(undefined); mockRasterizar.mockReset(); });
afterEach(() => { jest.restoreAllMocks(); });

describe('ESCPOS 80mm', () => {
  test('CA-07: usa ESC/POS y no el driver', async () => {
    await configurar({ modoImpresion: 'ESCPOS', escposAncho: 576, escposAvance: 2, escposUmbral: 170 });
    mockRaster400();
    const { espia, capturas } = espiarExecFile();

    const res = await imprimir();
    expect(res.status).toBe(200);
    expect(mockPrint).not.toHaveBeenCalled();
    expect(espia).toHaveBeenCalledTimes(1);

    const { file, args, bytes } = capturas[0];
    expect(file).toBe('powershell');
    expect(args).toEqual(expect.arrayContaining(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '-Impresora', IMPRESORA, '-Archivo']));
    expect(mockRasterizar).toHaveBeenCalledWith(expect.any(Buffer), 576);

    // estructura de CA-05: 400 filas => bandas de 256 + 144, 72 bytes por fila, fila 0 toda 0xFF
    expect([...bytes.subarray(0, 2)]).toEqual([0x1B, 0x40]);
    expect([...bytes.subarray(2, 10)]).toEqual([0x1D, 0x76, 0x30, 0x00, 72, 0, 0x00, 0x01]);
    expect([...bytes.subarray(10, 10 + 72)].every(b => b === 0xFF)).toBe(true);
    expect([...bytes.subarray(10 + 72, 10 + 144)].every(b => b === 0x00)).toBe(true);
    const inicio2 = 2 + 8 + 72 * 256;
    expect([...bytes.subarray(inicio2, inicio2 + 8)]).toEqual([0x1D, 0x76, 0x30, 0x00, 72, 0, 144, 0]);
    expect(bytes.length).toBe(2 + 8 + 72 * 256 + 8 + 72 * 144 + 7);
    expect([...bytes.subarray(bytes.length - 7)]).toEqual(FIN_AVANCE_2);
  });

  test('CA-10: si falla el ESC/POS no cae al driver y limpia el temporal', async () => {
    await configurar({ modoImpresion: 'ESCPOS' });
    mockRaster400();
    const { capturas } = espiarExecFile(new Error('spooler caído'));

    const res = await imprimir();
    expect(res.status).toBe(500);
    expect(res.body).toEqual(expect.objectContaining({ code: expect.any(String), message: expect.stringContaining(IMPRESORA) }));
    expect(mockPrint).not.toHaveBeenCalled();
    expect(capturas).toHaveLength(1);
    expect(fs.existsSync(capturas[0].ruta)).toBe(false);
  });

  test('CA-11: sin impresora configurada devuelve error claro y no invoca nada', async () => {
    await configurar({ modoImpresion: 'ESCPOS', impresora: '' });
    mockRaster400();
    const { espia } = espiarExecFile();

    const res = await imprimir();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body).toEqual(expect.objectContaining({ code: expect.any(String), message: expect.stringMatching(/impresora/i) }));
    expect(espia).not.toHaveBeenCalled();
    expect(mockPrint).not.toHaveBeenCalled();
  });

  test('CA-12: no deja .bin temporales (éxito y falla)', async () => {
    await configurar({ modoImpresion: 'ESCPOS' });
    mockRaster400();
    const antes = binesImpresion();

    espiarExecFile();
    expect((await imprimir()).status).toBe(200);
    jest.restoreAllMocks();
    espiarExecFile(new Error('falla'));
    expect((await imprimir()).status).toBe(500);

    expect(binesImpresion()).toEqual(antes);
  });

  test('CA-09: A4 y 58mm siguen por el driver', async () => {
    await configurar({ modoImpresion: 'ESCPOS' });
    mockRaster400();
    const { espia } = espiarExecFile();

    for (const papel of ['A4', '58mm']) {
      mockPrint.mockClear();
      const res = await imprimir({ idCaja: IDS.cajaAbierta, papel });
      expect(res.status).toBe(200);
      expect(mockPrint).toHaveBeenCalledTimes(1);
    }
    expect(espia).not.toHaveBeenCalled();
  });
});

describe('DRIVER', () => {
  test('CA-08: usa el driver como siempre', async () => {
    await configurar({ modoImpresion: 'DRIVER' });
    const { espia } = espiarExecFile();

    const res = await imprimir();
    expect(res.status).toBe(200);
    expect(mockPrint).toHaveBeenCalledTimes(1);
    const [ruta, opciones] = mockPrint.mock.calls[0];
    expect(path.extname(ruta)).toBe('.pdf');
    expect(opciones).toEqual({ printer: IMPRESORA, orientation: 'portrait', scale: 'noscale' });
    expect(espia).not.toHaveBeenCalled();
    expect(fs.existsSync(ruta)).toBe(false);
  });
});

// Ampliación 2026-11-26 (handoff_impresion_escpos.md, CA-14): /pedidos/imprimir-pdf/:id también pasa por el servicio.
describe('pedidos', () => {
  test('CA-14: imprimir-pdf de pedidos pasa por el servicio', async () => {
    const idPedido = await crearPedido();
    const imprimirPedido = () => api.post(`/pedidos/imprimir-pdf/${idPedido}`);
    mockRaster400();

    // ESCPOS: va por ESC/POS, no por el driver
    await configurar({ modoImpresion: 'ESCPOS', escposAncho: 576, escposAvance: 2 });
    let { espia, capturas } = espiarExecFile();
    expect((await imprimirPedido()).status).toBe(200);
    expect(mockPrint).not.toHaveBeenCalled();
    expect(espia).toHaveBeenCalledTimes(1);
    expect(capturas[0].args).toEqual(expect.arrayContaining(['-Impresora', IMPRESORA]));
    expect([...capturas[0].bytes.subarray(capturas[0].bytes.length - 7)]).toEqual(FIN_AVANCE_2);
    jest.restoreAllMocks();

    // DRIVER: igual que siempre
    await configurar({ modoImpresion: 'DRIVER' });
    ({ espia } = espiarExecFile());
    expect((await imprimirPedido()).status).toBe(200);
    expect(mockPrint).toHaveBeenCalledTimes(1);
    expect(mockPrint.mock.calls[0][1]).toEqual({ printer: IMPRESORA, orientation: 'portrait', scale: 'noscale' });
    expect(espia).not.toHaveBeenCalled();
    jest.restoreAllMocks();

    // ESCPOS con falla: 500, sin fallback al driver
    mockPrint.mockClear();
    await configurar({ modoImpresion: 'ESCPOS' });
    espiarExecFile(new Error('spooler caído'));
    expect((await imprimirPedido()).status).toBe(500);
    expect(mockPrint).not.toHaveBeenCalled();
  });
});
