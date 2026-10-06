#!/usr/bin/env node
// scripts/diagnostico/crear-referencia.js
//
// Fase 3.0 — construye diag_referencia: una base tal como quedaría una
// instalación nueva de EasySales hoy (script-bootstrap.sql + todas las
// migrations de src/db/tasks corridas encima). Sirve de referencia para
// el check C2 (deriva) en diagnosticar.js.
//
// Uso: node scripts/diagnostico/crear-referencia.js
//
// Un fallo de una migration sobre una instalación "nueva" ES un hallazgo
// (bootstrap y migrations ya no coinciden hoy), no algo que este script
// deba arreglar: se reporta y se frena.

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const knexLib = require('knex');

const DB_REFERENCIA = 'diag_referencia';
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const BOOTSTRAP_PATH = path.resolve(REPO_ROOT, 'src', 'db', 'script-bootstrap.sql');
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'db', 'tasks');

// Guardia de nombre — sin excepciones ni flag para saltearla. La comparten,
// cada una por su cuenta, crear-referencia.js y diagnosticar.js: acá el
// destino está hardcodeado a "diag_referencia", pero la dejamos igual para
// no depender de que nadie recuerde respetar la convención a mano si el
// valor cambia.
function asegurarPrefijoDiag(nombreBase) {
  if (!nombreBase.startsWith('diag_')) {
    throw new Error(
      `Guardia de seguridad: "${nombreBase}" no empieza con "diag_". ` +
      'Esta herramienta nunca corre contra una base que no sea explícitamente de diagnóstico.'
    );
  }
}

function leerCredencialesDb() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  if (!config.db || !config.db.host || !config.db.user) {
    throw new Error(`No encontré credenciales de DB en ${CONFIG_PATH} (esperaba config.db.{host,user,password}).`);
  }
  return config.db;
}

// Reescribe "USE dbeasysales;" -> "USE <nombreBaseDestino>;" en memoria.
// No toca script-bootstrap.sql en disco.
function prepararBootstrapSql(nombreBaseDestino) {
  const sqlOriginal = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');

  const usePattern = /^USE\s+dbeasysales\s*;/mi;
  if (!usePattern.test(sqlOriginal)) {
    throw new Error(
      `No encontré la línea "USE dbeasysales;" en ${BOOTSTRAP_PATH}. ` +
      'El reemplazo asume que existe exactamente una vez — revisar el archivo antes de seguir.'
    );
  }

  return sqlOriginal.replace(usePattern, `USE \`${nombreBaseDestino}\`;`);
}

async function crearBaseYCorrerBootstrap(credenciales) {
  const bootstrapSql = prepararBootstrapSql(DB_REFERENCIA);

  // multipleStatements: true vive SOLO en esta conexión y SOLO en este script
  // (tooling de desarrollo puntual). La app, y la conexión de knex más abajo,
  // siguen con el default (false).
  const conexion = await mysql.createConnection({
    host: credenciales.host,
    user: credenciales.user,
    password: credenciales.password,
    multipleStatements: true,
  });

  try {
    console.log(`Recreando base "${DB_REFERENCIA}" desde cero...`);
    await conexion.query(`DROP DATABASE IF EXISTS \`${DB_REFERENCIA}\`;`);
    await conexion.query(`CREATE DATABASE \`${DB_REFERENCIA}\`;`);

    console.log('Ejecutando script-bootstrap.sql sobre esa base...');
    await conexion.query(bootstrapSql);

    const [rows] = await conexion.query('SELECT DATABASE() AS db;');
    const baseActiva = rows[0].db;
    if (baseActiva !== DB_REFERENCIA) {
      throw new Error(
        `Después de correr el bootstrap, SELECT DATABASE() devolvió "${baseActiva}", ` +
        `esperaba "${DB_REFERENCIA}". Algo en el script cambió de base activa — no sigo.`
      );
    }
    console.log(`OK: bootstrap aplicado. Base activa confirmada: ${baseActiva}`);
  } finally {
    await conexion.end();
  }
}

async function correrMigrations(credenciales) {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: credenciales.host,
      user: credenciales.user,
      password: credenciales.password,
      database: DB_REFERENCIA,
    },
    migrations: {
      directory: MIGRATIONS_DIR,
    },
  });

  try {
    const raw = await knex.raw('SELECT DATABASE() AS db;');
    const baseActiva = raw[0][0].db;
    console.log(`Conexión de knex confirmada contra: ${baseActiva}`);
    if (baseActiva !== DB_REFERENCIA) {
      throw new Error(`knex está conectado a "${baseActiva}", no a "${DB_REFERENCIA}". Abortando antes de migrar.`);
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
    console.error('\nHALLAZGO: una migration falló sobre una instalación nueva de hoy.');
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
  asegurarPrefijoDiag(DB_REFERENCIA);
  const credenciales = leerCredencialesDb();

  await crearBaseYCorrerBootstrap(credenciales);
  await correrMigrations(credenciales);

  console.log(`\nListo: "${DB_REFERENCIA}" está construida (bootstrap + migrations) y lista para usarse como --ref en diagnosticar.js.`);
}

main().catch(err => {
  console.error('\nFalló crear-referencia.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
