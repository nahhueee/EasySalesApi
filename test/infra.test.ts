// Smoke test de la infraestructura de test: base correcta, login del usuario de prueba, red bloqueada.
import axios from 'axios';
import { api } from './helpers/api';
import { q1 } from './helpers/db';
import { IDS, PASS_TEST } from './helpers/ids';
import config from '../src/conf/app.config';

describe('infraestructura de test', () => {
  test('la app usa config.test.json y la base easysales_test', async () => {
    expect(config.db.database).toBe('easysales_test');
    const r: any = await q1('SELECT DATABASE() AS db');
    expect(r.db).toBe('easysales_test');
  });

  test('login del usuario de prueba', async () => {
    const res = await api.post('/usuarios/login', { idUsuario: IDS.usuarioAdmin, pass: PASS_TEST });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: IDS.usuarioAdmin, nombre: 'TEST ADMIN', cargo: 'ADMINISTRADOR' });
    expect(res.body.pass).toBeUndefined();
  });

  test('login con clave incorrecta -> 401', async () => {
    const res = await api.post('/usuarios/login', { idUsuario: IDS.usuarioAdmin, pass: 'mala' });
    expect(res.status).toBe(401);
  });

  test('la red externa está bloqueada (AdminServer)', async () => {
    await expect(axios.get(`${config.adminUrl}heartbeat`)).rejects.toThrow(/Nock: Disallowed net connect/);
    // Quedó registrada: el afterEach global haría fallar el test. Se consume acá para que este pase.
    const llamadas: string[] = (globalThis as any).__consumirLlamadasExternas();
    expect(llamadas.join()).toMatch(/adminserver-deshabilitado-en-test\.invalid/);
  });
});
