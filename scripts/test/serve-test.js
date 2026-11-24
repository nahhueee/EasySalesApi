#!/usr/bin/env node
// scripts/test/serve-test.js — levanta la API en MODO TEST (npm run start:test).
//
// NODE_ENV=test => config.test.json (base easysales_test, AdminServer apuntando a un host .invalid).
// En test, src/index.ts no hace listen ni arranca crons (heartbeat, batch de errores, backups, modo servidor):
// este script solo agrega el listen, en 127.0.0.1 y en el puerto de config.test.json.
// Lo usa el subagente verificador para ejecutar los criterios de aceptación con requests HTTP reales.

process.env.NODE_ENV = 'test';
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

require('ts-node').register({ project: path.join(ROOT, 'tsconfig.json'), transpileOnly: true });
const config = require(path.join(ROOT, 'src', 'conf', 'app.config')).default;
if (config.db.database !== 'easysales_test') {
  console.error(`serve-test: la config apunta a "${config.db.database}", no a easysales_test. Abortado.`);
  process.exit(1);
}

const app = require(path.join(ROOT, 'src', 'index')).default;
app.listen(config.port, '127.0.0.1', () => {
  console.log(`API en modo TEST: http://127.0.0.1:${config.port}/easysales  (base ${config.db.database})`);
});
