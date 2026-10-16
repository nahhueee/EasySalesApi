#!/usr/bin/env node
// scripts/diagnostico/generar-base.js
//
// USO ÚNICO — NO REGENERAR LA BASE.
//
// Fase 3.1-B: genera UNA vez la migration base (src/db/tasks/20260101000000_schema_base.js) a
// partir de una base de referencia (--db diag_referencia = bootstrap + todas las migrations,
// incluida la 3.1-A). El archivo generado se commitea y queda CONGELADO: nunca se edita ni se
// vuelve a generar (architecture.md §13). Este script queda en el repo solo como trazabilidad
// de cómo se obtuvo; se niega a pisar un archivo existente.
//
// Uso: node scripts/diagnostico/generar-base.js --db diag_referencia [--out ruta.js]
//
// Qué hace:
//  - DDL: SHOW CREATE TABLE de cada tabla (menos knex_migrations*), sin DEFAULT CHARSET /
//    COLLATE / CHARACTER SET / AUTO_INCREMENT=n (heredan el default de la base, igual que en
//    3.1-A). Conserva ENGINE=InnoDB y los nombres de constraints e índices.
//  - Orden de ejecución en la migration: tablas sin FKs -> semillas -> FKs (ALTER ... ADD).
//  - Semillas: contenido completo, con ids explícitos, de toda tabla con filas en la referencia.
//    Antes de generar verifica invariantes que las migrations viejas asumen (ver ASERCIONES).

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const OUT_DEFAULT = path.resolve(REPO_ROOT, 'src', 'db', 'tasks', '20260101000000_schema_base.js');
const EXCLUIDAS = ['knex_migrations', 'knex_migrations_lock'];

function parsearArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  if (!args.db) throw new Error('Falta --db <base>. Uso: node generar-base.js --db diag_referencia');
  if (!args.db.startsWith('diag_')) {
    throw new Error(`Guardia de seguridad: --db="${args.db}" no empieza con "diag_".`);
  }
  args.out = args.out || OUT_DEFAULT;
  return args;
}

function limpiarColumna(linea) {
  return linea
    .replace(/ CHARACTER SET \w+/gi, '')
    .replace(/ COLLATE \w+/gi, '');
}

function limpiarOpciones(linea) {
  return linea
    .replace(/ DEFAULT CHARSET=\w+/i, '')
    .replace(/ CHARSET=\w+/i, '')
    .replace(/ COLLATE=\w+/i, '')
    .replace(/ AUTO_INCREMENT=\d+/i, '');
}

// Devuelve { create, fks[] } para una tabla.
function transformarCreate(tabla, ddl) {
  const lineas = ddl.split('\n');
  const cierre = lineas[lineas.length - 1];
  const defs = lineas.slice(1, -1).map(l => l.replace(/,\s*$/, '').trim());
  const fks = [];
  const resto = [];
  for (const d of defs) {
    if (/^CONSTRAINT `[^`]+` FOREIGN KEY/i.test(d)) {
      fks.push(`ALTER TABLE \`${tabla}\` ADD ${d}`);
    } else {
      resto.push('  ' + limpiarColumna(d));
    }
  }
  const create = [lineas[0], resto.join(',\n'), limpiarOpciones(cierre)].join('\n');
  return { create, fks };
}

// Invariantes que las migrations viejas asumen de las semillas (auditoría 3.1-B).
function verificarSemillas(sem) {
  const err = [];
  const filas = (t) => (sem[t] ? sem[t].filas : []);
  const ok = (cond, msg) => { if (!cond) err.push(msg); };

  const pi = filas('parametros_impresion');
  ok(pi.length === 1 && pi[0].impresora === '' && pi[0].papel === '58mm' && pi[0].nomLocal === 'EASY SALES',
    "parametros_impresion: debe tener 1 fila (impresora='', papel='58mm', nomLocal='EASY SALES'), si no la migration 20260418164810 inserta un duplicado");

  const nombresTp = filas('tipos_pago').map(f => f.nombre);
  for (const n of ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'COMBINADO', 'QR', 'CUENTA CORRIENTE', 'SALDO A FAVOR']) {
    ok(nombresTp.includes(n), `tipos_pago: falta "${n}" (las migrations 20260319122219 / 20260703120000 lo insertarían de nuevo)`);
  }
  const ef = filas('tipos_pago').find(f => f.nombre === 'EFECTIVO');
  ok(ef && ef.id === 1, 'tipos_pago: EFECTIVO debe tener id=1 (el código lo asume)');

  const cl = filas('clientes');
  ok(cl.length === 1 && cl[0].id === 1, 'clientes: debe existir solo CONSUMIDOR FINAL con id=1');
  ok(cl[0] && cl[0].tipoDocumento !== null, 'clientes: CONSUMIDOR FINAL con tipoDocumento NULL (20260621180000 haría UPDATE)');

  const pr = filas('productos');
  ok(pr.length === 1 && pr[0].id === 1, 'productos: debe existir solo VARIOS con id=1');

  const us = filas('usuarios');
  ok(us.length >= 1 && us.every(u => typeof u.pass === 'string' && u.pass.startsWith('$2')),
    'usuarios: todas las passwords deben ser hash bcrypt ($2…), si no 20260731130000 las rehashea');

  const cg = filas('cargos').map(f => f.id).sort();
  ok(JSON.stringify(cg) === JSON.stringify([1, 2, 3]), 'cargos: deben existir los ids 1, 2 y 3');

  const ld = filas('listas_precio');
  ok(ld.length === 1 && ld[0].esDefault, 'listas_precio: debe existir 1 lista default (multiprecio)');

  const claves = filas('parametros').map(f => f.clave);
  for (const c of ['proveedores', 'repuestos']) ok(claves.includes(c), `parametros: falta la clave "${c}"`);

  if (err.length) throw new Error('Semillas no cumplen las invariantes:\n  - ' + err.join('\n  - '));
}

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  if (fs.existsSync(args.out)) {
    throw new Error(
      `${args.out} ya existe. La migration base está CONGELADA: no se regenera ni se pisa. ` +
      'Si realmente hay que rehacerla, hacerlo a mano y fuera de este script, con review.'
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).db;
  const con = await mysql.createConnection({
    host: cfg.host, user: cfg.user, password: cfg.password, database: args.db, dateStrings: true,
  });

  try {
    const [[{ db }]] = await con.query('SELECT DATABASE() AS db');
    if (db !== args.db) throw new Error(`Conectado a "${db}", esperaba "${args.db}".`);

    const [tablasRows] = await con.query(
      "SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    );
    const tablas = tablasRows.map(r => r.n).filter(n => !EXCLUIDAS.includes(n));

    const creates = [];
    const fks = [];
    const semillas = {};

    for (const t of tablas) {
      const [[fila]] = await con.query(`SHOW CREATE TABLE \`${t}\``);
      const ddl = fila['Create Table'];
      const { create, fks: f } = transformarCreate(t, ddl);
      creates.push(create);
      fks.push(...f);

      const [rows] = await con.query(`SELECT * FROM \`${t}\` ORDER BY 1`);
      if (rows.length) {
        for (const r of rows) {
          for (const [k, v] of Object.entries(r)) {
            if (Buffer.isBuffer(v)) throw new Error(`Valor binario en ${t}.${k}: no soportado por el generador.`);
          }
        }
        semillas[t] = { columnas: Object.keys(rows[0]), filas: rows.map(r => ({ ...r })) };
      }
    }

    for (const s of [...creates, ...fks]) {
      if (s.includes('?')) throw new Error('Un DDL contiene "?": knex.raw lo interpretaría como binding. Revisar a mano:\n' + s);
      if (/CHARACTER SET|COLLATE|CHARSET|AUTO_INCREMENT=/i.test(s)) throw new Error('Quedó CHARSET/COLLATE/AUTO_INCREMENT en el DDL:\n' + s);
    }
    verificarSemillas(semillas);

    const fecha = new Date().toISOString().slice(0, 10);
    const salida = plantilla({ args, fecha, tablas, creates, fks, semillas });
    fs.writeFileSync(args.out, salida, 'utf8');

    console.log(`Generado: ${args.out}`);
    console.log(`  Tablas: ${creates.length} | FKs: ${fks.length}`);
    console.log('  Tablas semilla (filas):');
    for (const [t, s] of Object.entries(semillas)) console.log(`    ${t}: ${s.filas.length}`);
  } finally {
    await con.end();
  }
}

function plantilla({ args, fecha, creates, fks, semillas }) {
  const j = (x) => JSON.stringify(x, null, 2);
  return `// MIGRATION BASE — CONGELADA. NO EDITAR. NO REGENERAR.
//
// Fase 3.1-B. Foto del schema objetivo de EasySales (bootstrap + todas las migrations hasta la
// reconciliación 3.1-A), generada UNA vez el ${fecha} desde la base "${args.db}" con
// scripts/diagnostico/generar-base.js. Ese script queda solo como trazabilidad.
//
// Reglas (architecture.md §13):
//  - Esta migration no se edita ni se regenera nunca. Cambiar el schema = escribir otra migration.
//  - Una migration que ya corrió en algún ambiente no cambia su efecto; solo se le pueden agregar
//    guardas de idempotencia.
//  - Nunca fijar CHARSET ni COLLATE en un DDL: todo hereda el default de la base.
//
// Cómo funciona (todo o nada):
//  - Si existe la tabla \`ventas\`  -> instalación existente: no-op. (Su timestamp es anterior a
//    todas las demás: knex la corre primero, pero en una base existente no hace nada.)
//  - Si la base no tiene NINGUNA tabla (ignorando knex_migrations*) -> crea todo + semillas.
//  - Cualquier otro caso (base a medias) -> error. Una base a medias es un error de instalación
//    y tiene que verse, no tolerarse con CREATE TABLE IF NOT EXISTS.
//
// Orden al crear: tablas sin FKs -> semillas (ids explícitos) -> FKs. Después corren las demás
// migrations, que sobre este schema son no-op (tienen guardas de existencia).

const TABLAS = ${j(creates)};

const FKS = ${j(fks)};

const SEMILLAS = ${j(semillas)};

const EXCLUIDAS = ['knex_migrations', 'knex_migrations_lock'];

exports.up = async function (knex) {
  const [filas] = await knex.raw(
    "SELECT TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  const existentes = filas.map((f) => f.nombre).filter((n) => !EXCLUIDAS.includes(n));

  if (existentes.includes('ventas')) return; // instalación existente: no-op

  if (existentes.length > 0) {
    throw new Error(
      'schema_base: la base tiene ' + existentes.length + ' tabla(s) pero no tiene "ventas" (' +
      existentes.slice(0, 5).join(', ') + (existentes.length > 5 ? ', …' : '') + '). ' +
      'Es una base a medias (instalación interrumpida o manipulada): no se continúa. ' +
      'Borrar la base y reinstalar.'
    );
  }

  for (const ddl of TABLAS) {
    await knex.raw(ddl);
  }

  for (const [tabla, semilla] of Object.entries(SEMILLAS)) {
    await knex(tabla).insert(semilla.filas);
  }

  for (const ddl of FKS) {
    await knex.raw(ddl);
  }
};

exports.down = async function () {
  // No-op a propósito: una migration nunca borra el schema completo.
};
`;
}

main().catch((err) => {
  console.error('\nFalló generar-base.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
