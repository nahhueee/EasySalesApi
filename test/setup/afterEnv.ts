// Corre en cada archivo de test, antes de los tests.
import nock from 'nock';

const LOCAL = /^(127\.0\.0\.1|localhost|::1|\[::1\])(:\d+)?$/;

// 1) Nada de red salvo localhost (supertest levanta la app en 127.0.0.1). Una llamada a AdminServer
//    (u otro host) hace FALLAR el test aunque el código la atrape en un try/catch.
nock.disableNetConnect();
nock.enableNetConnect(LOCAL);
const llamadasExternas: string[] = [];
nock.emitter.on('no match', (req: any) => {
  const host = String(req?.options?.host ?? req?.host ?? req?.hostname ?? '');
  if (!LOCAL.test(host)) llamadasExternas.push(`${req?.method ?? ''} ${host}${req?.path ?? ''}`);
});
// Solo para el smoke test que verifica este mismo mecanismo (test/infra.test.ts).
(globalThis as any).__consumirLlamadasExternas = () => llamadasExternas.splice(0);
afterEach(() => {
  const llamadas = llamadasExternas.splice(0);
  if (llamadas.length) throw new Error(`Llamada de red externa en test: ${llamadas.join(', ')}`);
});

// 2) Los errores provocados por los tests no se encolan para AdminServer (errores-pendientes.json).
jest.mock('../../src/services/errorBatchService', () => ({
  ErrorBatchServ: { registrar: jest.fn(), IniciarCron: jest.fn() },
}));

// 3) Sin ruido en la salida: morgan (log HTTP) no-op. El log de winston a consola lo calla `silent`
//    en jest.config.js (correr con --silent=false para verlo).
jest.mock('morgan', () => () => (_req: any, _res: any, next: any) => next());

// 4) Cerrar pools al final de cada archivo (si no, Jest queda colgado).
afterAll(async () => {
  const { cerrarDb } = await import('../helpers/db');
  await cerrarDb();
  const pool = (await import('../../src/db')).default;
  await pool.end();
});
