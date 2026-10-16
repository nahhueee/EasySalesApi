#!/usr/bin/env node
// scripts/diagnostico/crear-referencia.js
//
// Construye una base de referencia tal como queda una instalación NUEVA de EasySales:
// base vacía + knex.migrate.latest() con todas las migrations de src/db/tasks (la primera es
// la migration base 20260101000000_schema_base, Fase 3.1-B). Sirve de referencia para el check
// C2 (deriva) de diagnosticar.js, y de validación de que una instalación nueva y una actualizada
// terminan con el mismo schema (checklist de release con migrations nuevas, architecture.md §13).
//
// Uso: node scripts/diagnostico/crear-referencia.js [--db diag_referencia]
//
// Un fallo de una migration sobre una instalación "nueva" ES un hallazgo (la base y las
// migrations ya no coinciden), no algo que este script deba arreglar: se reporta y se frena.

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const knexLib = require('knex');

const DB_DEFAULT = 'diag_referencia';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'db', 'tasks');

function parsearArgs(argv) {
  const args = { db: DB_DEFAULT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  return args;
}

// Guardia de nombre — sin excepciones ni flag para saltearla. Este script hace DROP DATABASE.
function asegurarPrefijoDiag(nombreBase) {
  if (!nombreBase || !nombreBase.startsWith('diag_')) {
    throw new Error(
      `Guardia de seguridad: "${nombreBase}" no empieza con "diag_". ` +
      'Esta herramienta nunca corre contra una base que no sea explícitamente de diagnóstico.'
    );
  }
}

function leerCredencialesDb() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!config.db || !config.db.host || !config.db.user) {
    throw new Error(`No encontré credenciales de DB en ${CONFIG_PATH} (esperaba config.db.{host,user,password}).`);
  }
  return config.db;
}

async function recrearBaseVacia(credenciales, nombreBase) {
  const conexion = await mysql.createConnection({
    host: credenciales.host,
    user: credenciales.user,
    password: credenciales.password,
  });
  try {
    console.log(`Recreando base "${nombreBase}" desde cero (vacía, sin charset explícito)...`);
    await conexion.query(`DROP DATABASE IF EXISTS \`${nombreBase}\`;`);
    await conexion.query(`CREATE DATABASE \`${nombreBase}\`;`);
  } finally {
    await conexion.end();
  }
}

async function correrMigrations(credenciales, nombreBase) {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: credenciales.host,
      user: credenciales.user,
      password: credenciales.password,
      database: nombreBase,
    },
    migrations: { directory: MIGRATIONS_DIR },
  });

  try {
    const raw = await knex.raw('SELECT DATABASE() AS db;');
    const baseActiva = raw[0][0].db;
    console.log(`Conexión de knex confirmada contra: ${baseActiva}`);
    if (baseActiva !== nombreBase) {
      throw new Error(`knex está conectado a "${baseActiva}", no a "${nombreBase}". Abortando antes de migrar.`);
    }

    console.log(`Corriendo knex.migrate.latest() (directory: ${MIGRATIONS_DIR})...`);
    const [batchNo, log] = await knex.migrate.latest();

    if (log.length === 0) {
      console.log('knex no aplicó ninguna migration (inesperado sobre una base recién creada — revisar directory/conexión).');
    } else {
      console.log(`Batch ${batchNo} — ${log.length} migration(s) aplicadas:`);
      for (const nombreMigration of log) {
        console.log(`  OK  ${nombreMigration}`);
      }
    }
  } catch (err) {
    console.error('\nHALLAZGO: una migration falló sobre una instalación nueva.');
    console.error(`  ${err.message}`);
    console.error(
      'No se "arregla" la migration acá — esto es justo el tipo de deriva que el ' +
      'diagnóstico tiene que sacar a la luz. Reportarlo en la descripción del PR.'
    );
    throw err;
  } finally {
    await knex.destroy();
  }
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  asegurarPrefijoDiag(args.db);
  const credenciales = leerCredencialesDb();

  await recrearBaseVacia(credenciales, args.db);
  await correrMigrations(credenciales, args.db);

  console.log(`\nListo: "${args.db}" está construida (base vacía + migrations) y lista para usarse como --ref en diagnosticar.js.`);
}

main().catch(err => {
  console.error('\nFalló crear-referencia.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
