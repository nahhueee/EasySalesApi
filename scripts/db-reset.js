#!/usr/bin/env node
// scripts/db-reset.js
//
// Desarrollo: borra y recrea la base de config.<NODE_ENV|pc>.json y corre todas las migrations
// (la primera, 20260101000000_schema_base, crea el schema y las semillas). Reemplaza el reset
// manual con SQL de la base de dev (Fase 3.1-B).
//
// Uso:  npm run db:reset -- --confirmar
//       (el "--" es necesario: sin él npm se queda con el flag y el script no lo recibe)
//
// Guardas:
//  - aborta si config.produccion === true
//  - exige --confirmar; sin él no hace nada
//  - muestra el nombre de la base (y el host) antes de borrar

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const knexLib = require('knex');

const ROOT = path.resolve(__dirname, '..');
const ENV = process.env.NODE_ENV || 'pc';
const CONFIG_PATH = path.resolve(ROOT, `config.${ENV}.json`);
const MIGRATIONS_DIR = path.resolve(ROOT, 'src', 'db', 'tasks');

async function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  if (config.produccion === true) {
    throw new Error(`config.${ENV}.json tiene produccion=true: db:reset no corre nunca contra producción.`);
  }
  if (!config.db || !config.db.host || !config.db.user || !config.db.database) {
    throw new Error(`No encontré config.db.{host,user,password,database} en ${CONFIG_PATH}.`);
  }
  const { host, user, password, database } = config.db;
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`Nombre de base inválido: "${database}" (solo letras, números y guion bajo).`);
  }

  // npm se come "--confirmar" si no va después de "--": lo detectamos para avisar bien.
  const confirmado = process.argv.includes('--confirmar') || process.env.npm_config_confirmar === 'true';

  console.log(`Base a RECREAR: "${database}" en ${host} (config.${ENV}.json)`);
  if (!confirmado) {
    console.log('No se hizo nada. Para confirmar:  npm run db:reset -- --confirmar');
    process.exit(1);
  }

  const con = await mysql.createConnection({ host, user, password });
  try {
    await con.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await con.query(`CREATE DATABASE \`${database}\``);
  } finally {
    await con.end();
  }
  console.log(`Base "${database}" recreada vacía. Corriendo migrations...`);

  const knex = knexLib({
    client: 'mysql2',
    connection: { host, user, password, database },
    migrations: { directory: MIGRATIONS_DIR },
  });
  try {
    const [batchNo, log] = await knex.migrate.latest();
    console.log(`Batch ${batchNo} — ${log.length} migration(s) aplicadas.`);
  } finally {
    await knex.destroy();
  }
  console.log('Listo.');
}

main().catch((err) => {
  console.error('\nFalló db:reset:');
  console.error(err.stack || err.message);
  process.exit(1);
});
