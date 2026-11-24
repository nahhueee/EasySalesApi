#!/usr/bin/env node
// scripts/test/db-reset-test.js
//
// Recrea la base de TEST desde cero: DROP + CREATE + todas las migrations + seed fijo (seed-test.js).
// Uso:  npm run db:reset:test
//
// Es independiente de NODE_ENV a propósito: SIEMPRE lee config.test.json. Nunca puede apuntar a la base
// real por un NODE_ENV olvidado. Guardas (todas abortan antes de conectarse):
//  - la base tiene que llamarse exactamente "easysales_test"
//  - el usuario MySQL tiene que ser "easysales_test" (que solo tiene GRANT sobre easysales_test.*)
//  - la base no puede coincidir con la de config.pc.json ni config.web.json
//  - config.test.json no puede tener produccion=true
//
// Charset: igual al de la base real (dbeasysales, leído 2026-11-23): utf8mb4 / utf8mb4_0900_ai_ci.

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const knexLib = require('knex');
const { seed } = require('./seed-test');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(ROOT, 'config.test.json');
const MIGRATIONS_DIR = path.resolve(ROOT, 'src', 'db', 'tasks');

const BASE_TEST = 'easysales_test';
const USUARIO_TEST = 'easysales_test';
const CHARSET = 'utf8mb4';
const COLLATION = 'utf8mb4_0900_ai_ci';

function basesReales() {
  const nombres = [];
  for (const env of ['pc', 'web']) {
    const p = path.resolve(ROOT, `config.${env}.json`);
    if (fs.existsSync(p)) {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (c.db && c.db.database) nombres.push(c.db.database);
    }
  }
  return nombres;
}

async function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`No existe ${CONFIG_PATH}. Ver CLAUDE.md (modo test).`);
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const { host, user, password, database } = config.db || {};

  if (config.produccion === true) throw new Error('config.test.json tiene produccion=true. Abortado.');
  if (database !== BASE_TEST) throw new Error(`config.test.json apunta a "${database}", se exige "${BASE_TEST}". Abortado.`);
  if (user !== USUARIO_TEST) throw new Error(`config.test.json usa el usuario "${user}", se exige "${USUARIO_TEST}". Abortado.`);
  if (basesReales().includes(database)) throw new Error(`"${database}" es la base de un config real. Abortado.`);

  console.log(`Recreando base de TEST "${database}" en ${host} (usuario ${user})...`);

  const con = await mysql.createConnection({ host, user, password });
  try {
    await con.query(`DROP DATABASE IF EXISTS \`${BASE_TEST}\``);
    await con.query(`CREATE DATABASE \`${BASE_TEST}\` CHARACTER SET ${CHARSET} COLLATE ${COLLATION}`);
  } finally {
    await con.end();
  }

  const knex = knexLib({
    client: 'mysql2',
    connection: { host, user, password, database: BASE_TEST },
    migrations: { directory: MIGRATIONS_DIR },
  });
  try {
    const [batchNo, log] = await knex.migrate.latest();
    console.log(`Batch ${batchNo}: ${log.length} migration(s) aplicadas.`);
    if (!process.argv.includes('--sin-seed')) {
      await seed(knex);
      console.log('Seed de test aplicado.');
    }
  } finally {
    await knex.destroy();
  }
  console.log('Listo.');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('\nFalló db:reset:test:');
    console.error(err.stack || err.message);
    process.exit(1);
  });
}

module.exports = { main };
