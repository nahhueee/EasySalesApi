// handoff_impresion_escpos.md CA-01 a CA-04: migración y whitelist de parametros_impresion.
import fs from 'fs';
import path from 'path';
import { api } from '../helpers/api';
import { q, q1, cerrarDb } from '../helpers/db';

const CAMPOS = 'modoImpresion, escposUmbral, escposAvance, escposAncho';
const leer = () => q1<any>(`SELECT ${CAMPOS} FROM parametros_impresion`);
const actualizar = (body: any) => api.post('/parametros/actualizar-impresion', body);

let original: any;
beforeAll(async () => { original = await leer(); });
// La base es compartida con otros archivos: se restauran los valores que se tocaron.
afterAll(async () => {
  await q('UPDATE parametros_impresion SET modoImpresion = ?, escposUmbral = ?, escposAvance = ?, escposAncho = ?',
    [original.modoImpresion, original.escposUmbral, original.escposAvance, original.escposAncho]);
  // El afterAll global (test/setup/afterEnv.ts) corre ANTES que este y ya cerró el pool; q() lo
  // reabre, así que hay que volver a cerrarlo o Jest queda colgado.
  await cerrarDb();
});

describe('migración', () => {
  test('CA-01: columnas, defaults e idempotencia', async () => {
    const fila = await leer();
    expect(fila).toMatchObject({ modoImpresion: 'DRIVER', escposUmbral: 170, escposAvance: 2, escposAncho: 576 });

    const cols: any[] = await q(
      `SELECT COLUMN_NAME, IS_NULLABLE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'parametros_impresion'
         AND COLUMN_NAME IN ('modoImpresion','escposUmbral','escposAvance','escposAncho')`);
    expect(cols).toHaveLength(4);
    expect(cols.every(c => c.IS_NULLABLE === 'NO')).toBe(true);

    // up() por segunda vez no falla
    const knexLib = require('knex');
    const config = require('../../config.test.json');
    const knex = knexLib({ client: 'mysql2', connection: config.db });
    try {
      const dir = path.resolve(__dirname, '..', '..', 'src', 'db', 'tasks');
      const archivo = fs.readdirSync(dir).find((f: string) => f.endsWith('_parametros_impresion_escpos.js'));
      expect(archivo).toBeDefined();
      await expect(require(path.join(dir, archivo as string)).up(knex)).resolves.not.toThrow();
    } finally { await knex.destroy(); }
  });
});

describe('obtener-impresion', () => {
  test('CA-02: incluye los campos ESC/POS', async () => {
    const res = await api.get('/parametros/obtener-impresion');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ modoImpresion: 'DRIVER', escposUmbral: 170, escposAvance: 2, escposAncho: 576 });
  });
});

describe('actualizar-impresion', () => {
  test('CA-03: guarda valores válidos (el modo se normaliza a mayúsculas)', async () => {
    const res = await actualizar({ modoImpresion: 'escpos', escposUmbral: 190, escposAvance: 0, escposAncho: 512 });
    expect(res.status).toBe(200);
    expect(await leer()).toMatchObject({ modoImpresion: 'ESCPOS', escposUmbral: 190, escposAvance: 0, escposAncho: 512 });
  });

  test('CA-04: valores fuera de rango se ignoran sin pisar los actuales', async () => {
    await actualizar({ modoImpresion: 'escpos', escposUmbral: 190, escposAvance: 0, escposAncho: 512 });
    const igual = { modoImpresion: 'ESCPOS', escposUmbral: 190, escposAvance: 0, escposAncho: 512 };

    const res = await actualizar({ modoImpresion: 'XX', escposUmbral: 5, escposAvance: 99, escposAncho: 600 });
    expect(res.status).toBe(200);
    expect(await leer()).toMatchObject(igual);

    const invalidos: any[] = [
      { modoImpresion: 'XX' }, { escposUmbral: 59 }, { escposUmbral: 221 },
      { escposAvance: -1 }, { escposAvance: 11 }, { escposAncho: 0 },
    ];
    for (const body of invalidos) {
      const r = await actualizar(body);
      expect(r.status).toBe(200);
      expect(await leer()).toMatchObject(igual);
    }
  });
});
