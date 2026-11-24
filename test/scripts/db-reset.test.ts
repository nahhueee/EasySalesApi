// Protección de scripts/db-reset.js (reset de la base de DESARROLLO). Se prueba como caja negra:
// se ejecuta el script como proceso hijo con NODE_ENV=test, así que lee config.test.json y solo
// puede apuntar a easysales_test. Algunos casos recrean la base: al final se restaura con el seed.
//
// Capas que tiene que cumplir el script:
//  1. Confirmar escribiendo el nombre de la base: --confirmar=<base>. "--confirmar" solo no alcanza.
//  2. No borrar una base con datos (ventas, clientes o productos además de las semillas).
//  3. Backup con mysqldump antes del DROP; si el backup falla, no se borra nada.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { contar, q } from '../helpers/db';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { main: resetTest } = require('../../scripts/test/db-reset-test');

const API = path.resolve(__dirname, '..', '..');
const BASE = 'easysales_test';
const DIR_BACKUPS = path.resolve(API, 'backups', 'db-reset');

jest.setTimeout(180000);

function dbReset(args: string[], envExtra: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [path.resolve(API, 'scripts', 'db-reset.js'), ...args], {
    cwd: API, encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'test', npm_config_confirmar: '', ...envExtra },
  });
  return { code: r.status, salida: `${r.stdout}\n${r.stderr}` };
}
const backupsDeTest = () =>
  fs.existsSync(DIR_BACKUPS) ? fs.readdirSync(DIR_BACKUPS).filter(f => f.startsWith(`${BASE}_`)) : [];

async function silenciado<T>(fn: () => Promise<T>): Promise<T> {
  const log = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = log; }
}

afterAll(async () => {
  for (const f of backupsDeTest()) fs.unlinkSync(path.join(DIR_BACKUPS, f));
  await silenciado(() => resetTest());          // deja easysales_test como la dejó globalSetup (con seed)
});

describe('db-reset.js: confirmar escribiendo el nombre de la base', () => {
  test('sin --confirmar no hace nada', async () => {
    const antes = await contar('clientes');
    const r = dbReset([]);
    expect(r.code).toBe(1);
    expect(r.salida).toMatch(/No se hizo nada/);
    expect(await contar('clientes')).toBe(antes);
  });

  test('--confirmar sin el nombre de la base no alcanza', async () => {
    const antes = await contar('clientes');
    const r = dbReset(['--confirmar']);
    expect(r.code).toBe(1);
    expect(r.salida).toMatch(/--confirmar=easysales_test/);
    expect(await contar('clientes')).toBe(antes);
  });

  test('--confirmar con otro nombre de base no hace nada', async () => {
    const antes = await contar('clientes');
    const r = dbReset(['--confirmar=dbeasysales']);
    expect(r.code).toBe(1);
    expect(r.salida).toMatch(/no coincide/i);
    expect(await contar('clientes')).toBe(antes);
  });
});

describe('db-reset.js: no borra una base con datos', () => {
  test('con clientes/productos además de las semillas: aborta, no hace backup ni borra', async () => {
    // La base viene del seed de test: clientes 2 y 3, productos 10 y 11.
    const antes = await contar('clientes');
    const backupsAntes = backupsDeTest().length;
    const r = dbReset([`--confirmar=${BASE}`]);
    expect(r.code).toBe(1);
    expect(r.salida).toMatch(/tiene datos/i);
    expect(r.salida).toMatch(/clientes/);
    expect(await contar('clientes')).toBe(antes);
    expect(backupsDeTest().length).toBe(backupsAntes);
  });
});

describe('db-reset.js: backup antes del DROP', () => {
  beforeAll(async () => {
    await silenciado(() => resetTest({ conSeed: false }));   // solo migrations + semillas: "sin datos"
  });

  test('si el backup falla, no borra nada', async () => {
    await q(`INSERT INTO parametros (clave, valor) VALUES ('marca_test_reset', 'x')`);
    const r = dbReset([`--confirmar=${BASE}`], { MYSQLDUMP: path.join(API, 'no-existe', 'mysqldump.exe') });
    expect(r.code).toBe(1);
    expect(r.salida).toMatch(/backup/i);
    expect(await contar('parametros', "clave = 'marca_test_reset'")).toBe(1);
  });

  test('base sin datos y nombre correcto: hace el backup y recién después recrea la base', async () => {
    const backupsAntes = backupsDeTest();
    const r = dbReset([`--confirmar=${BASE}`]);
    expect(r.code).toBe(0);

    const nuevos = backupsDeTest().filter(f => !backupsAntes.includes(f));
    expect(nuevos).toHaveLength(1);
    const dump = fs.readFileSync(path.join(DIR_BACKUPS, nuevos[0]), 'utf8');
    expect(dump).toMatch(/CREATE TABLE `ventas`/);
    expect(dump).toMatch(/marca_test_reset/);                 // el backup es de la base ANTES del DROP

    expect(await contar('parametros', "clave = 'marca_test_reset'")).toBe(0);   // recreada
    expect(await contar('knex_migrations')).toBeGreaterThanOrEqual(60);
  });
});
