#!/usr/bin/env node
// scripts/db-reset.js
//
// Desarrollo: borra y recrea la base de config.<NODE_ENV|pc>.json y corre todas las migrations
// (la primera, 20260101000000_schema_base, crea el schema y las semillas). Reemplaza el reset
// manual con SQL de la base de dev (Fase 3.1-B).
//
// Uso:  npm run db:reset -- --confirmar=<nombre_de_la_base>
//       (el "--" es necesario: sin él npm se queda con el flag y el script no lo recibe)
//
// Para la base de TESTS no se usa este script: ver scripts/test/db-reset-test.js (npm run db:reset:test).
//
// Guardas (2026-11-24: las capas 2 a 4 se agregaron porque produccion=false no alcanzaba para
// proteger una base con datos reales). Se prueban en test/scripts/db-reset.test.ts.
//  1. aborta si config.produccion === true
//  2. exige --confirmar=<nombre de la base>; "--confirmar" solo, u otro nombre, no hace nada
//  3. aborta si la base tiene datos: ventas, o clientes / productos además de las semillas
//     (CONSUMIDOR FINAL y VARIOS). Una base con datos se borra a mano, nunca con este script.
//  4. backup con mysqldump (estructura + datos) en backups/db-reset/ ANTES del DROP; si falla,
//     no se borra nada. Binario: variable MYSQLDUMP o "mysqldump" del PATH.

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const knexLib = require('knex');

const ROOT = path.resolve(__dirname, '..');
const ENV = process.env.NODE_ENV || 'pc';
const CONFIG_PATH = path.resolve(ROOT, `config.${ENV}.json`);
const MIGRATIONS_DIR = path.resolve(ROOT, 'src', 'db', 'tasks');
const DIR_BACKUPS = path.resolve(ROOT, 'backups', 'db-reset');

// Valor de --confirmar=<x>. Devuelve '' si vino "--confirmar" solo, y null si no vino.
function leerConfirmacion() {
  const arg = process.argv.find((a) => a === '--confirmar' || a.startsWith('--confirmar='));
  if (arg) return arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : '';
  // npm sin "--": `npm run db:reset --confirmar=x` llega como npm_config_confirmar
  const npm = process.env.npm_config_confirmar;
  if (npm === undefined || npm === '') return null;
  return npm === 'true' ? '' : npm;
}

// Cuenta lo que no son semillas. Devuelve null si la base no existe (no hay nada que proteger).
async function contarDatos(con, database) {
  const [bases] = await con.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [database]);
  if (bases.length === 0) return null;

  const [tablas] = await con.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [database]);
  const existe = new Set(tablas.map((r) => r.t));
  const consultas = {
    ventas: 'SELECT COUNT(*) AS n FROM `ventas`',
    clientes: 'SELECT COUNT(*) AS n FROM `clientes` WHERE id <> 1',                   // 1 = CONSUMIDOR FINAL
    productos: "SELECT COUNT(*) AS n FROM `productos` WHERE codigo IS NULL OR codigo <> '*'", // '*' = VARIOS
  };
  const datos = {};
  await con.query(`USE \`${database}\``);
  for (const [tabla, sql] of Object.entries(consultas)) {
    if (!existe.has(tabla)) continue;
    const [[fila]] = await con.query(sql);
    if (Number(fila.n) > 0) datos[tabla] = Number(fila.n);
  }
  return datos;
}

function backup({ host, user, password, database }) {
  fs.mkdirSync(DIR_BACKUPS, { recursive: true });
  const sello = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
  const archivo = path.join(DIR_BACKUPS, `${database}_${sello}.sql`);
  const r = spawnSync(process.env.MYSQLDUMP || 'mysqldump', [
    `--user=${user}`, `--host=${host}`, '--single-transaction', '--no-tablespaces', '--routines',
    `--result-file=${archivo}`, database,
  ], { env: { ...process.env, MYSQL_PWD: password }, encoding: 'utf8' });

  const ok = r.status === 0 && fs.existsSync(archivo) && fs.statSync(archivo).size > 0;
  if (!ok) {
    if (fs.existsSync(archivo)) fs.unlinkSync(archivo);
    const detalle = r.error ? r.error.message : (r.stderr || '').trim();
    throw new Error(`Falló el backup previo con mysqldump (${detalle || 'sin detalle'}). No se borró nada.`);
  }
  return archivo;
}

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

  console.log(`Base a RECREAR: "${database}" en ${host} (config.${ENV}.json)`);

  // Capa 2: confirmar escribiendo el nombre.
  const confirmacion = leerConfirmacion();
  if (confirmacion === null) {
    console.log(`No se hizo nada. Para confirmar:  npm run db:reset -- --confirmar=${database}`);
    process.exit(1);
  }
  if (confirmacion === '') {
    console.log(`No se hizo nada: hay que escribir el nombre de la base.  npm run db:reset -- --confirmar=${database}`);
    process.exit(1);
  }
  if (confirmacion !== database) {
    console.log(`No se hizo nada: "${confirmacion}" no coincide con la base de config.${ENV}.json ("${database}").`);
    process.exit(1);
  }

  const con = await mysql.createConnection({ host, user, password });
  try {
    // Capa 3: no borrar una base con datos.
    const datos = await contarDatos(con, database);
    if (datos && Object.keys(datos).length > 0) {
      const detalle = Object.entries(datos).map(([t, n]) => `${t}: ${n}`).join(', ');
      console.log(`No se hizo nada: la base "${database}" tiene datos (${detalle}). db:reset no borra bases con datos.`);
      process.exit(1);
    }

    // Capa 4: backup antes del DROP (solo si la base existe).
    if (datos !== null) {
      const archivo = backup({ host, user, password, database });
      console.log(`Backup previo: ${archivo}`);
    }

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
