#!/usr/bin/env node
// scripts/diagnostico/migrar.js
//
// Fase 3.1-A — corre knex.migrate.latest() (o down) contra UNA base "diag_*". Sirve para validar
// la migration de reconciliación sobre copias de backups reales sin tocar dbeasysales.
//
// Uso:
//   node scripts/diagnostico/migrar.js --db diag_a_31
//   node scripts/diagnostico/migrar.js --db diag_a_31 --down
//   node scripts/diagnostico/migrar.js --db diag_a_31 --cortar-despues-del-paso 2
//
//   --down                          revierte la ÚLTIMA migration aplicada (knex.migrate.down()).
//   --cortar-despues-del-paso N     test de interrupción (V3): hace fallar la migration de
//                                   reconciliación a propósito después del paso N (1 a 4).
//                                   Setea EASYSALES_TEST_CORTE_PASO, que solo existe para esto.
//
// Los avisos (warn) de la migration se escriben en
// scripts/diagnostico/informes/migrar_<db>_avisos.log (fuera de git), no en el log real del updater.

const path = require('path');
const fs = require('fs');
const knexLib = require('knex');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'db', 'tasks');
const INFORMES_DIR = path.resolve(__dirname, 'informes');

function parsearArgs(argv) {
  const args = { down: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--down') args.down = true;
    else if (arg === '--cortar-despues-del-paso') args.corte = argv[++i];
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!args.db) {
    throw new Error('Falta --db <nombre_base>. Uso: node migrar.js --db diag_a_31 [--down] [--cortar-despues-del-paso N]');
  }
  if (args.corte !== undefined && !/^[1-4]$/.test(args.corte)) {
    throw new Error('--cortar-despues-del-paso espera un número de 1 a 4.');
  }
  return args;
}

// Guardia de nombre — sin excepciones ni flag para saltearla (igual que diagnosticar.js).
function asegurarPrefijoDiag(nombreBase) {
  if (!nombreBase.startsWith('diag_')) {
    throw new Error(
      `Guardia de seguridad: --db="${nombreBase}" no empieza con "diag_". ` +
      'Esta herramienta nunca migra una base que no sea explícitamente de diagnóstico.'
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

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  asegurarPrefijoDiag(args.db);
  const credenciales = leerCredencialesDb();

  fs.mkdirSync(INFORMES_DIR, { recursive: true });
  process.env.EASYSALES_AVISOS_LOG = path.join(INFORMES_DIR, `migrar_${args.db}_avisos.log`);
  if (args.corte !== undefined) process.env.EASYSALES_TEST_CORTE_PASO = args.corte;

  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: credenciales.host,
      user: credenciales.user,
      password: credenciales.password,
      database: args.db,
    },
    migrations: { directory: MIGRATIONS_DIR },
  });

  try {
    const raw = await knex.raw('SELECT DATABASE() AS db, VERSION() AS version;');
    const { db: baseActiva, version } = raw[0][0];
    console.log(`Conexión de knex confirmada contra: ${baseActiva} (MySQL ${version})`);
    if (baseActiva !== args.db) {
      throw new Error(`knex está conectado a "${baseActiva}", no a "${args.db}". Abortando antes de migrar.`);
    }

    const [, pendientesAntes] = await knex.migrate.list();
    console.log(`Migrations pendientes antes de correr: ${pendientesAntes.length}`);
    for (const m of pendientesAntes) console.log(`  pendiente  ${m.file || m.name || m}`);

    if (args.down) {
      console.log('\nknex.migrate.down() — revirtiendo la última migration aplicada...');
      const [batchNo, log] = await knex.migrate.down();
      console.log(log.length === 0
        ? 'No había nada para revertir.'
        : `Batch ${batchNo} — revertida(s): ${log.join(', ')}`);
    } else {
      console.log('\nknex.migrate.latest()...');
      const [batchNo, log] = await knex.migrate.latest();
      if (log.length === 0) {
        console.log('Sin cambios: no había migrations pendientes.');
      } else {
        console.log(`Batch ${batchNo} — ${log.length} migration(s) aplicadas:`);
        for (const nombre of log) console.log(`  OK  ${nombre}`);
      }
    }

    if (fs.existsSync(process.env.EASYSALES_AVISOS_LOG)) {
      console.log(`\nAvisos de la migration en: ${process.env.EASYSALES_AVISOS_LOG}`);
    }
  } finally {
    await knex.destroy();
  }
}

main().catch(err => {
  console.error('\nFalló migrar.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
