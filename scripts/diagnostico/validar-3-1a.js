#!/usr/bin/env node
// scripts/diagnostico/validar-3-1a.js
//
// Fase 3.1-A — valida la migration 20261007143500_reconciliar_schema_fase3.js sobre UNA copia de un
// backup (base "diag_*"). Automatiza V1, V2, V3 y V4 del handoff y los criterios de aceptación #3 y #4:
//
//   V3  corte a la mitad: migra con un error provocado después del paso 2, verifica que NO quedó
//       registrada, y reintenta. (Se omite con --sin-v3.)
//   V1  la migration termina OK; se reportan todos los avisos.
//   A*  aserciones sobre el resultado (tipos, NULL/default/PK preservados, índices, FKs, deriva y
//       que no cambió ningún conteo de filas: la migration no toca datos).
//   V2  idempotencia: se borra su registro de knex_migrations y se vuelve a correr: schema idéntico.
//   V4  down y up de nuevo: schema idéntico.
//
// NO cubre V5 (node scripts/diagnostico/crear-referencia.js), V6 (diagnosticar.js sobre cada copia
// migrada) ni V7 (humo con la app): son manuales, ver PRUEBAS_3_1A.md.
//
// Uso:
//   node scripts/diagnostico/validar-3-1a.js --db diag_a_31 [--sin-v3] [--comparar-con diag_otra_copia]
//
// --comparar-con: otra copia (ya migrada) con la que el schema final tiene que ser IDÉNTICO. Sirve para
// demostrar que "cortar y reintentar" (V3) converge al mismo resultado que una migración limpia (V1):
//   1) migrar una copia con --sin-v3;  2) validar otra copia del mismo backup con --comparar-con <la 1ª>.
//
// Es destructivo sobre la base indicada (migra, revierte, borra su registro de knex_migrations):
// solo corre contra bases con prefijo "diag_".

const path = require('path');
const fs = require('fs');
const knexLib = require('knex');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'db', 'tasks');
const INFORMES_DIR = path.resolve(__dirname, 'informes');
const NOMBRE_MIGRATION = '20261007143500_reconciliar_schema_fase3';
const MIGRATION = require(path.join(MIGRATIONS_DIR, `${NOMBRE_MIGRATION}.js`));

function parsearArgs(argv) {
  const args = { sinV3: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--db') args.db = argv[++i];
    else if (a === '--sin-v3') args.sinV3 = true;
    else if (a === '--comparar-con') args.comparar = argv[++i];
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  if (!args.db) throw new Error('Falta --db. Uso: node validar-3-1a.js --db diag_a_31 [--sin-v3] [--comparar-con diag_otra]');
  return args;
}

function asegurarPrefijoDiag(nombre, origen) {
  if (!nombre.startsWith('diag_')) {
    throw new Error(`Guardia de seguridad: ${origen}="${nombre}" no empieza con "diag_". Esta herramienta es destructiva y nunca corre contra otra base.`);
  }
}

function conectar(db) {
  const { db: cfg } = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return knexLib({
    client: 'mysql2',
    connection: { host: cfg.host, user: cfg.user, password: cfg.password, database: db },
    migrations: { directory: MIGRATIONS_DIR },
  });
}

async function filas(knex, sql, bindings) {
  const [rows] = await knex.raw(sql, bindings || []);
  return rows;
}

// ---- foto del schema --------------------------------------------------------------------------

async function tomarFoto(knex, db) {
  const columnas = await filas(knex,
    `SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE tipo, IS_NULLABLE nul, IFNULL(COLUMN_DEFAULT,'<NULL>') def,
            EXTRA extra, COLUMN_KEY llave
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);
  const indices = await filas(knex,
    `SELECT TABLE_NAME t, INDEX_NAME i, SEQ_IN_INDEX s, COLUMN_NAME c, NON_UNIQUE nu
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [db]);
  const fks = await filas(knex,
    `SELECT k.TABLE_NAME t, k.COLUMN_NAME c, k.CONSTRAINT_NAME n, k.REFERENCED_TABLE_NAME p,
            k.REFERENCED_COLUMN_NAME pc, r.DELETE_RULE dr
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME
     WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.COLUMN_NAME`, [db]);
  const tablas = await filas(knex,
    `SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY 1`, [db]);
  const conteos = {};
  for (const { t } of tablas) conteos[t] = Number((await filas(knex, `SELECT COUNT(*) n FROM \`${t}\``))[0].n);
  const mapaCol = new Map(columnas.map(c => [`${c.t}.${c.c}`, c]));
  const texto = [
    ...columnas.map(c => `C|${c.t}|${c.c}|${c.tipo}|${c.nul}|${c.def}|${c.extra}|${c.llave}`),
    ...indices.map(i => `I|${i.t}|${i.i}|${i.s}|${i.c}|${i.nu}`),
    ...fks.map(f => `F|${f.t}|${f.c}|${f.n}|${f.p}|${f.pc}|${f.dr}`),
  ].join('\n');
  return { columnas, mapaCol, indices, fks, conteos, texto };
}

function diffTexto(a, b) {
  const sa = new Set(a.split('\n')), sb = new Set(b.split('\n'));
  return [...[...sa].filter(x => !sb.has(x)).map(x => `- ${x}`), ...[...sb].filter(x => !sa.has(x)).map(x => `+ ${x}`)];
}

// ---- infraestructura de resultados -------------------------------------------------------------

const resultados = [];
function registrar(id, descripcion, ok, detalle) {
  resultados.push({ id, descripcion, ok, detalle });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${id.padEnd(4)} ${descripcion}${detalle ? ` — ${detalle}` : ''}`);
}

function leerAvisos(rutaLog, desdeLinea) {
  if (!fs.existsSync(rutaLog)) return { warns: [], total: 0 };
  const lineas = fs.readFileSync(rutaLog, 'utf8').split('\n').filter(Boolean);
  const nuevas = lineas.slice(desdeLinea);
  return { warns: nuevas.filter(l => l.includes('[WARN]')).map(l => l.replace(/^.*modulo=[^|]+\| /, '')), total: lineas.length };
}

// ---- main --------------------------------------------------------------------------------------

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  asegurarPrefijoDiag(args.db, '--db');
  if (args.comparar) asegurarPrefijoDiag(args.comparar, '--comparar-con');

  fs.mkdirSync(INFORMES_DIR, { recursive: true });
  const rutaLog = path.join(INFORMES_DIR, `validar_${args.db}_avisos.log`);
  if (fs.existsSync(rutaLog)) fs.unlinkSync(rutaLog);
  process.env.EASYSALES_AVISOS_LOG = rutaLog;

  const knex = conectar(args.db);
  try {
    const [{ base, version }] = await filas(knex, 'SELECT DATABASE() base, VERSION() version');
    if (base !== args.db) throw new Error(`Conectado a "${base}", no a "${args.db}". Aborto.`);
    console.log(`Base: ${base} · MySQL ${version}\n`);

    const [, pendientes] = await knex.migrate.list();
    if (!pendientes.some(m => (m.file || m.name || m).includes(NOMBRE_MIGRATION))) {
      throw new Error('La migration de 3.1-A no está pendiente en esta base (¿ya se migró?). Usar una copia fresca del backup.');
    }
    const fotoAntes = await tomarFoto(knex, args.db);
    let lineaLog = 0;

    // ---- V3: corte a la mitad ----
    if (!args.sinV3) {
      process.env.EASYSALES_TEST_CORTE_PASO = '2';
      let fallo = null;
      try { await knex.migrate.latest(); } catch (e) { fallo = e; }
      delete process.env.EASYSALES_TEST_CORTE_PASO;
      const [{ n }] = await filas(knex, 'SELECT COUNT(*) n FROM knex_migrations WHERE name LIKE ?', [`%${NOMBRE_MIGRATION}%`]);
      registrar('V3a', 'el corte provocado después del paso 2 hace fallar la migration y no queda registrada',
        Boolean(fallo) && Number(n) === 0, fallo ? '' : 'no falló');
      lineaLog = leerAvisos(rutaLog, 0).total;
    }

    // ---- V1: migrar ----
    let v1ok = true, v1err = '';
    try { await knex.migrate.latest(); } catch (e) { v1ok = false; v1err = e.message; }
    const { warns } = leerAvisos(rutaLog, lineaLog);
    registrar('V1', args.sinV3 ? 'migrate.latest() termina OK' : 'V3b: el reintento sin el error termina OK', v1ok, v1err);
    if (!v1ok) throw new Error('V1 falló; no tiene sentido seguir.');
    console.log(`     avisos (${warns.length}):`); for (const w of warns) console.log(`       - ${w}`);

    const foto1 = await tomarFoto(knex, args.db);

    // ---- aserciones ----
    // A1 — tipos: cada columna alineada pasó al tipo del padre (o está en un aviso).
    const norm = t => String(t).toLowerCase().replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
    const sinAlinear = [];
    for (const [hija, col, padre] of MIGRATION.TIPOS_A_ALINEAR) {
      const h = foto1.mapaCol.get(`${hija}.${col}`), p = foto1.mapaCol.get(`${padre}.id`);
      if (!h || !p) continue;
      if (norm(h.tipo) !== norm(p.tipo) && !warns.some(w => w.startsWith(`${hija}.${col}`))) sinAlinear.push(`${hija}.${col}`);
    }
    registrar('A1', 'las 14 columnas hija quedaron con el tipo del padre (o salteadas con aviso)', sinAlinear.length === 0, sinAlinear.join(', '));

    // A2 — criterio #4: el MODIFY preservó NULL/NOT NULL, default, PK y EXTRA.
    const cambiaron = [];
    for (const [hija, col] of MIGRATION.TIPOS_A_ALINEAR) {
      const a = fotoAntes.mapaCol.get(`${hija}.${col}`), d = foto1.mapaCol.get(`${hija}.${col}`);
      if (!a || !d) continue;
      for (const campo of ['nul', 'def', 'extra']) if (a[campo] !== d[campo]) cambiaron.push(`${hija}.${col}.${campo}: ${a[campo]} -> ${d[campo]}`);
      if ((a.llave === 'PRI') !== (d.llave === 'PRI')) cambiaron.push(`${hija}.${col}.PK: ${a.llave} -> ${d.llave}`);
    }
    registrar('A2', 'criterio #4: NULL/NOT NULL, DEFAULT, PK y EXTRA de las 14 columnas se preservaron', cambiaron.length === 0, cambiaron.join('; '));

    // A3 — índices
    const sinIndice = [];
    for (const [t, c] of MIGRATION.INDICES) {
      if (!foto1.mapaCol.has(`${t}.${c}`)) continue;
      if (!foto1.indices.some(i => i.t === t && i.c === c && Number(i.s) === 1) && !warns.some(w => w.startsWith(`${t}.${c}`))) sinIndice.push(`${t}.${c}`);
    }
    registrar('A3', 'las columnas de §12.2 son primera columna de algún índice (o salteadas con aviso)', sinIndice.length === 0, sinIndice.join(', '));

    // A4 — FKs
    const sinFk = [];
    for (const fk of MIGRATION.FKS_DECLARADAS) {
      if (!foto1.mapaCol.has(`${fk.tabla}.${fk.columna}`)) continue;
      const existe = foto1.fks.some(f => f.t === fk.tabla && f.c === fk.columna);
      if (!existe && !warns.some(w => w.includes(`${fk.tabla}.${fk.columna}`))) sinFk.push(`${fk.tabla}.${fk.columna}`);
    }
    registrar('A4', 'las FKs declaradas por migrations existen (o salteadas con aviso)', sinFk.length === 0, sinFk.join(', '));

    // A5 — deriva
    const fb = foto1.mapaCol.get('productos.fechaBaja'), ic = foto1.mapaCol.get('ventas.idCaja');
    const deriva = [];
    if (fb && !/^datetime/i.test(fb.tipo) && !warns.some(w => w.startsWith('productos.fechaBaja'))) deriva.push(`productos.fechaBaja es ${fb.tipo}`);
    if (ic && ic.nul !== 'YES' && !warns.some(w => w.startsWith('ventas.idCaja'))) deriva.push('ventas.idCaja sigue NOT NULL');
    registrar('A5', 'deriva ampliada: productos.fechaBaja DATETIME y ventas.idCaja nullable', deriva.length === 0, deriva.join('; '));

    // A6 — no toca datos
    const conteosDistintos = Object.keys(fotoAntes.conteos).filter(t => fotoAntes.conteos[t] !== foto1.conteos[t] && t !== 'knex_migrations');
    registrar('A6', 'ningún conteo de filas cambió (la migration no toca datos)', conteosDistintos.length === 0, conteosDistintos.join(', '));

    // ---- V2: idempotencia del cuerpo de up() ----
    await knex('knex_migrations').where('name', 'like', `%${NOMBRE_MIGRATION}%`).del();
    let v2err = '';
    try { await knex.migrate.latest(); } catch (e) { v2err = e.message; }
    const foto2 = await tomarFoto(knex, args.db);
    const dif2 = diffTexto(foto1.texto, foto2.texto);
    registrar('V2', 'volver a correr la migration no cambia nada (idempotente)', !v2err && dif2.length === 0, v2err || dif2.slice(0, 3).join(' | '));

    // ---- V4: down y up ----
    let v4err = '';
    try { await knex.migrate.down(); await knex.migrate.latest(); } catch (e) { v4err = e.message; }
    const foto4 = await tomarFoto(knex, args.db);
    const dif4 = diffTexto(foto1.texto, foto4.texto);
    registrar('V4', 'down y up de nuevo: sin errores y schema idéntico', !v4err && dif4.length === 0, v4err || dif4.slice(0, 3).join(' | '));

    // ---- comparación contra otra copia ----
    if (args.comparar) {
      const otro = conectar(args.comparar);
      try {
        const fotoOtra = await tomarFoto(otro, args.comparar);
        const dif = diffTexto(foto1.texto, fotoOtra.texto);
        registrar('V3c', `schema final idéntico al de ${args.comparar} (corte+reintento converge a la migración limpia)`, dif.length === 0, dif.slice(0, 3).join(' | '));
      } finally { await otro.destroy(); }
    }

    // ---- informe ----
    const md = [
      `# Validación 3.1-A — ${args.db}`, '', `MySQL ${version} · ${new Date().toISOString().slice(0, 10)}`, '',
      '| # | Prueba | Resultado |', '|---|---|---|',
      ...resultados.map(r => `| ${r.id} | ${r.descripcion} | ${r.ok ? 'OK' : 'FALLA'}${r.detalle ? ` — ${r.detalle}` : ''} |`),
      '', `## Avisos de V1 (${warns.length})`, '', ...(warns.length ? warns.map(w => `- ${w}`) : ['(ninguno)']), '',
      '_V5, V6 y V7 son manuales: ver PRUEBAS_3_1A.md._', '',
    ].join('\n');
    const rutaInforme = path.join(INFORMES_DIR, `validacion_3_1a_${args.db}.md`);
    fs.writeFileSync(rutaInforme, md, 'utf8');
    const fallas = resultados.filter(r => !r.ok).length;
    console.log(`\n${fallas === 0 ? 'TODO OK' : `${fallas} PRUEBA(S) FALLARON`} — informe: ${rutaInforme}`);
    process.exitCode = fallas === 0 ? 0 : 2;
  } finally {
    await knex.destroy();
  }
}

main().catch(err => {
  console.error('\nFalló validar-3-1a.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
