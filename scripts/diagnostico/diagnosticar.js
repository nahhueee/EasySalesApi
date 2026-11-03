#!/usr/bin/env node
// scripts/diagnostico/diagnosticar.js
//
// Fase 3.0 — corre los checks C1-C12 (ver documentos/handoff_fase3_0_diagnostico_schema.md;
// C12 es de la 3.4-0, ver documentos/handoff_fase3_4_0_diagnostico_caja.md)
// contra una base "diag_*" (backup real restaurado, o diag_referencia) y escribe un informe
// en markdown. Solo lectura: únicamente SELECT e information_schema.
//
// Uso:
//   node scripts/diagnostico/diagnosticar.js --db diag_cliente_a [--ref diag_referencia] [--dump ruta.sql]
//
// Salida: scripts/diagnostico/informes/<db>_<YYYYMMDD>.md

const path = require('path');
const fs = require('fs');
const mysql = require('mysql2/promise');
const relaciones = require('./relaciones');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.resolve(REPO_ROOT, `config.${process.env.NODE_ENV || 'pc'}.json`);
const MIGRATIONS_DIR = path.resolve(REPO_ROOT, 'src', 'db', 'tasks');
const INFORMES_DIR = path.resolve(__dirname, 'informes');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parsearArgs(argv) {
  const args = { db: null, ref: null, dump: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--ref') args.ref = argv[++i];
    else if (arg === '--dump') args.dump = argv[++i];
  }
  if (!args.db) {
    throw new Error('Falta --db <nombre_base>. Uso: node diagnosticar.js --db diag_cliente_a [--ref diag_referencia] [--dump ruta.sql]');
  }
  return args;
}

// Guardia de nombre — sin excepciones ni flag para saltearla. Se aplica tanto a --db como a
// --ref: correr con --ref apuntando a algo que no sea diag_* sería la misma clase de error.
function asegurarPrefijoDiag(nombreBase, origen) {
  if (!nombreBase.startsWith('diag_')) {
    throw new Error(
      `Guardia de seguridad: ${origen}="${nombreBase}" no empieza con "diag_". ` +
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

// Lee solo las primeras 10 líneas del dump para sacar "-- Server version" (header estándar
// de mysqldump). El servidor local no representa al del cliente.
function versionMysqlDelDump(rutaDump) {
  if (!rutaDump) return null;
  try {
    const fd = fs.openSync(rutaDump, 'r');
    const buffer = Buffer.alloc(8192);
    const bytesLeidos = fs.readSync(fd, buffer, 0, buffer.length, 0);
    fs.closeSync(fd);
    const primerasLineas = buffer.toString('utf8', 0, bytesLeidos).split('\n').slice(0, 10);
    for (const linea of primerasLineas) {
      const match = linea.match(/--\s*Server version\s+(.+)$/i);
      if (match) return match[1].trim();
    }
    return 'no detectada (no encontré "-- Server version" en las primeras 10 líneas)';
  } catch (err) {
    return `no se pudo leer --dump: ${err.message}`;
  }
}

// ---------------------------------------------------------------------------
// Acceso a datos (information_schema + queries de negocio)
// ---------------------------------------------------------------------------

async function filas(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows;
}

async function obtenerTablas(conn, db) {
  return filas(conn,
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
     ORDER BY TABLE_NAME`,
    [db]
  );
}

// Mapa tabla -> { columna -> {COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY} }
async function obtenerColumnas(conn, db) {
  const rows = await filas(conn,
    `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?`,
    [db]
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.TABLE_NAME)) mapa.set(r.TABLE_NAME, new Map());
    mapa.get(r.TABLE_NAME).set(r.COLUMN_NAME, r);
  }
  return mapa;
}

// Mapa tabla -> Map(columna -> [nombresDeIndice...]) — para saber si una columna tiene índice
// propio o es prefijo de uno compuesto (SEQ_IN_INDEX = 1 en el índice, o cualquier posición
// cuenta como "tiene índice que la incluye"; acá solo nos importa "tiene algún índice").
async function obtenerIndices(conn, db) {
  const rows = await filas(conn,
    `SELECT TABLE_NAME, COLUMN_NAME, INDEX_NAME, SEQ_IN_INDEX
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ?`,
    [db]
  );
  const mapa = new Map();
  for (const r of rows) {
    if (!mapa.has(r.TABLE_NAME)) mapa.set(r.TABLE_NAME, new Map());
    const porColumna = mapa.get(r.TABLE_NAME);
    if (!porColumna.has(r.COLUMN_NAME)) porColumna.set(r.COLUMN_NAME, []);
    porColumna.get(r.COLUMN_NAME).push({ nombre: r.INDEX_NAME, posicion: r.SEQ_IN_INDEX });
  }
  return mapa;
}

function tieneIndice(indicesMap, tabla, columna) {
  const porColumna = indicesMap.get(tabla);
  if (!porColumna) return false;
  const entradas = porColumna.get(columna);
  return Boolean(entradas && entradas.length > 0);
}

// FKs realmente existentes en la base (no las que "deberían" existir según relaciones.js).
async function obtenerForeignKeys(conn, db) {
  const rows = await filas(conn,
    `SELECT kcu.TABLE_NAME AS tabla, kcu.COLUMN_NAME AS columna,
            kcu.REFERENCED_TABLE_NAME AS tablaReferenciada, kcu.REFERENCED_COLUMN_NAME AS columnaReferenciada,
            kcu.CONSTRAINT_NAME AS nombre, rc.DELETE_RULE AS reglaBorrado
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
     WHERE kcu.TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY tabla, columna`,
    [db]
  );
  const mapa = new Map(); // "tabla.columna" -> fila
  for (const r of rows) mapa.set(`${r.tabla}.${r.columna}`, r);
  return { rows, mapa };
}

// PK de una tabla: si es de una sola columna, esa; si no hay o es compuesta, null.
function pkDeUnaColumna(columnasTabla) {
  if (!columnasTabla) return null;
  const pks = [...columnasTabla.values()].filter(c => c.COLUMN_KEY === 'PRI');
  return pks.length === 1 ? pks[0].COLUMN_NAME : null;
}

// Columna a usar como identificador de fila para las muestras de huérfanos (C5): 'id' si
// existe, si no la PK de una sola columna, si no la propia columna de la relación (mejor un
// identificador imperfecto que ninguno).
function columnaIdentificadora(columnasTabla, columnaRelacion) {
  if (!columnasTabla) return columnaRelacion;
  if (columnasTabla.has('id')) return 'id';
  const pk = pkDeUnaColumna(columnasTabla);
  return pk || columnaRelacion;
}

// ---------------------------------------------------------------------------
// Reporte (acumula hallazgos/errores por check y renderiza el markdown final)
// ---------------------------------------------------------------------------

function crearReporte() {
  const checks = [];
  let actual = null;

  function iniciarCheck(id, titulo) {
    actual = { id, titulo, hallazgosCriticos: 0, hallazgosNormales: 0, errores: 0, cuerpo: [] };
    checks.push(actual);
  }
  function linea(texto) {
    actual.cuerpo.push(texto);
  }
  function tabla(headers, rows) {
    if (rows.length === 0) return;
    actual.cuerpo.push(`| ${headers.join(' | ')} |`);
    actual.cuerpo.push(`|${headers.map(() => '---').join('|')}|`);
    for (const fila of rows) {
      actual.cuerpo.push(`| ${fila.join(' | ')} |`);
    }
    actual.cuerpo.push('');
  }
  function hallazgo(texto, opciones = {}) {
    actual.cuerpo.push(`- **HALLAZGO${opciones.critico ? ' CRÍTICO' : ''}:** ${texto}`);
    if (opciones.critico) actual.hallazgosCriticos++; else actual.hallazgosNormales++;
  }
  function error(texto) {
    actual.cuerpo.push(`- **ERROR:** ${texto}`);
    actual.errores++;
  }
  function estadoDe(check) {
    if (check.errores > 0) return 'ERROR';
    if (check.hallazgosCriticos > 0 || check.hallazgosNormales > 0) return 'HALLAZGO';
    return 'OK';
  }
  function render({ db, fecha, versionMysqlLocal, versionMysqlCliente, ref }) {
    const totalCriticos = checks.reduce((acc, c) => acc + c.hallazgosCriticos, 0);
    const totalNormales = checks.reduce((acc, c) => acc + c.hallazgosNormales, 0);
    const totalErrores = checks.reduce((acc, c) => acc + c.errores, 0);

    const partes = [];
    partes.push(`# Diagnóstico — ${db} — ${fecha}`);
    partes.push(`Origen: ${versionMysqlCliente || versionMysqlLocal + ' (local, sin --dump)'} · Referencia: ${ref || 'no provista'}`);
    partes.push('');
    partes.push('## Resumen');
    partes.push('');
    partes.push(`- ${totalCriticos} hallazgos críticos · ${totalNormales} hallazgos · ${totalErrores} errores`);
    partes.push('');
    partes.push('| Check | Estado |');
    partes.push('|---|---|');
    for (const c of checks) {
      partes.push(`| ${c.id} — ${c.titulo} | ${estadoDe(c)} |`);
    }
    partes.push('');
    for (const c of checks) {
      partes.push(`## ${c.id}. ${c.titulo}`);
      partes.push('');
      partes.push(`Estado: **${estadoDe(c)}**`);
      partes.push('');
      if (c.cuerpo.length === 0) {
        partes.push('(sin observaciones)');
      } else {
        partes.push(...c.cuerpo);
      }
      partes.push('');
    }
    return partes.join('\n');
  }

  return { iniciarCheck, linea, tabla, hallazgo, error, render, checks };
}

function formatoBytes(bytes) {
  if (bytes == null) return '?';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// C1 — Servidor y tablas
// ---------------------------------------------------------------------------

async function checkC1(conn, ctx) {
  const [{ 'VERSION()': versionLocal }] = await filas(conn, 'SELECT VERSION() AS `VERSION()`');
  ctx.reporte.linea(`MySQL local (donde corre este script): ${versionLocal}`);
  if (ctx.versionMysqlCliente) {
    ctx.reporte.linea(`MySQL del cliente (según --dump): ${ctx.versionMysqlCliente}`);
  } else {
    ctx.reporte.linea('MySQL del cliente: no se pasó --dump, no se puede determinar.');
  }
  ctx.reporte.linea('');

  const filasTabla = [];
  const tablasCollationNoUtf8mb4 = [];
  for (const t of ctx.tablas) {
    // COUNT(*) real: TABLE_ROWS es una estimación de InnoDB y da 0 (o cualquier cosa) justo
    // después de restaurar un backup.
    let filasReales = '?';
    try {
      const [{ n }] = await filas(conn, `SELECT COUNT(*) AS n FROM \`${t.TABLE_NAME}\``);
      filasReales = String(n);
    } catch (err) {
      ctx.reporte.error(`COUNT(*) de \`${t.TABLE_NAME}\`: ${err.message}`);
    }
    filasTabla.push([
      t.TABLE_NAME,
      t.ENGINE || '?',
      t.TABLE_COLLATION || '?',
      filasReales,
      formatoBytes((t.DATA_LENGTH || 0) + (t.INDEX_LENGTH || 0)),
    ]);
    if (t.ENGINE && t.ENGINE.toUpperCase() === 'MYISAM') {
      ctx.reporte.hallazgo(`tabla \`${t.TABLE_NAME}\` usa MyISAM — MyISAM ignora las FKs sin avisar.`, { critico: true });
    }
    if (t.TABLE_COLLATION && !/^utf8mb4/i.test(t.TABLE_COLLATION)) {
      tablasCollationNoUtf8mb4.push(`${t.TABLE_NAME} (${t.TABLE_COLLATION})`);
    }
  }
  if (tablasCollationNoUtf8mb4.length > 0) {
    ctx.reporte.hallazgo(
      `${tablasCollationNoUtf8mb4.length} tabla(s) con collation distinta de utf8mb4*: ` +
      tablasCollationNoUtf8mb4.slice(0, 5).join(', ') + (tablasCollationNoUtf8mb4.length > 5 ? ', ...' : '')
    );
  }
  ctx.reporte.tabla(['Tabla', 'Engine', 'Collation', 'Filas', 'Tamaño'], filasTabla);
}

// ---------------------------------------------------------------------------
// C2 — Deriva contra referencia
// ---------------------------------------------------------------------------

async function checkC2(conn, ctx) {
  if (!ctx.ref) {
    ctx.reporte.linea('No se pasó --ref: check omitido.');
    return;
  }

  const tablasDb = new Set(ctx.tablas.map(t => t.TABLE_NAME));
  const tablasRef = new Set(ctx.refTablas.map(t => t.TABLE_NAME));

  const faltantes = [...tablasRef].filter(t => !tablasDb.has(t)).sort();
  const sobrantes = [...tablasDb].filter(t => !tablasRef.has(t)).sort();

  if (faltantes.length > 0) {
    ctx.reporte.hallazgo(`tablas que están en la referencia y faltan acá: ${faltantes.join(', ')}`);
  }
  if (sobrantes.length > 0) {
    ctx.reporte.hallazgo(`tablas que están acá y no en la referencia: ${sobrantes.join(', ')}`);
  }

  const tablasComunes = [...tablasDb].filter(t => tablasRef.has(t)).sort();

  for (const tabla of tablasComunes) {
    const colsDb = ctx.columnas.get(tabla) || new Map();
    const colsRef = ctx.refColumnas.get(tabla) || new Map();

    const nombresDb = new Set(colsDb.keys());
    const nombresRef = new Set(colsRef.keys());

    const colFaltantes = [...nombresRef].filter(c => !nombresDb.has(c)).sort();
    const colSobrantes = [...nombresDb].filter(c => !nombresRef.has(c)).sort();
    const diffsColumna = [];

    for (const col of [...nombresDb].filter(c => nombresRef.has(c)).sort()) {
      const a = colsDb.get(col);
      const b = colsRef.get(col);
      const campos = ['COLUMN_TYPE', 'IS_NULLABLE', 'COLUMN_DEFAULT', 'EXTRA'];
      const diffs = campos.filter(campo => String(a[campo]) !== String(b[campo]));
      if (diffs.length > 0) {
        diffsColumna.push(
          `\`${col}\`: ` + diffs.map(campo => `${campo} acá="${a[campo]}" vs ref="${b[campo]}"`).join('; ')
        );
      }
    }

    // Índices: comparamos por firma (columnas en orden) por tabla, no por nombre de índice
    // (dos instalaciones pueden nombrar el mismo índice distinto).
    const firmaIndices = (indicesMap, tabla) => {
      const porColumna = indicesMap.get(tabla);
      if (!porColumna) return new Set();
      const porIndice = new Map();
      for (const [columna, entradas] of porColumna) {
        for (const e of entradas) {
          if (!porIndice.has(e.nombre)) porIndice.set(e.nombre, []);
          porIndice.get(e.nombre)[e.posicion - 1] = columna;
        }
      }
      return new Set([...porIndice.values()].map(cols => cols.join(',')));
    };
    const indicesDb = firmaIndices(ctx.indices, tabla);
    const indicesRef = firmaIndices(ctx.refIndices, tabla);
    const indicesFaltantes = [...indicesRef].filter(f => !indicesDb.has(f));
    const indicesSobrantes = [...indicesDb].filter(f => !indicesRef.has(f));

    // FKs por firma columna->tabla.columna referenciada.
    const firmaFks = (fkRows, tabla) => new Set(
      fkRows.filter(r => r.tabla === tabla).map(r => `${r.columna}->${r.tablaReferenciada}.${r.columnaReferenciada}`)
    );
    const fksDb = firmaFks(ctx.foreignKeys.rows, tabla);
    const fksRef = firmaFks(ctx.refForeignKeys.rows, tabla);
    const fksFaltantes = [...fksRef].filter(f => !fksDb.has(f));
    const fksSobrantes = [...fksDb].filter(f => !fksRef.has(f));

    const hayDiferencias = colFaltantes.length || colSobrantes.length || diffsColumna.length ||
      indicesFaltantes.length || indicesSobrantes.length || fksFaltantes.length || fksSobrantes.length;

    if (!hayDiferencias) continue;

    ctx.reporte.linea(`### \`${tabla}\``);
    if (colFaltantes.length) ctx.reporte.hallazgo(`columnas de la referencia que faltan acá: ${colFaltantes.join(', ')}`);
    if (colSobrantes.length) ctx.reporte.hallazgo(`columnas acá que no están en la referencia: ${colSobrantes.join(', ')}`);
    for (const d of diffsColumna) ctx.reporte.hallazgo(d);
    if (indicesFaltantes.length) ctx.reporte.hallazgo(`índices de la referencia que faltan acá: ${indicesFaltantes.join(' | ')}`);
    if (indicesSobrantes.length) ctx.reporte.hallazgo(`índices acá que no están en la referencia: ${indicesSobrantes.join(' | ')}`);
    if (fksFaltantes.length) ctx.reporte.hallazgo(`FKs de la referencia que faltan acá: ${fksFaltantes.join(' | ')}`);
    if (fksSobrantes.length) ctx.reporte.hallazgo(`FKs acá que no están en la referencia: ${fksSobrantes.join(' | ')}`);
    ctx.reporte.linea('');
  }
}

// ---------------------------------------------------------------------------
// C3 — knex_migrations
// ---------------------------------------------------------------------------

async function checkC3(conn, ctx) {
  const existe = ctx.tablas.some(t => t.TABLE_NAME === 'knex_migrations');
  if (!existe) {
    ctx.reporte.hallazgo('no existe la tabla `knex_migrations` en esta base — nunca corrió knex acá.');
    return;
  }

  const archivosDir = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.js')).sort();
  const filasAplicadas = await filas(conn, 'SELECT name, migration_time FROM knex_migrations ORDER BY migration_time');
  const nombresAplicados = new Set(filasAplicadas.map(r => r.name));

  const sinAplicar = archivosDir.filter(f => !nombresAplicados.has(f));
  const aplicadasNoEnDir = [...nombresAplicados].filter(n => !archivosDir.includes(n));

  if (sinAplicar.length > 0) {
    ctx.reporte.hallazgo(`migrations en el directorio que no están aplicadas acá: ${sinAplicar.join(', ')}`);
  }
  if (aplicadasNoEnDir.length > 0) {
    ctx.reporte.hallazgo(`migrations aplicadas acá que no están en el directorio: ${aplicadasNoEnDir.join(', ')}`);
  }
  if (filasAplicadas.length > 0) {
    const primera = filasAplicadas[0];
    ctx.reporte.linea(`Primera migration aplicada: \`${primera.name}\` (${primera.migration_time}) — aproxima la antigüedad de la instalación.`);
  }
}

// ---------------------------------------------------------------------------
// C4 — Compatibilidad de tipos por relación (+ columnas id* sin clasificar)
// ---------------------------------------------------------------------------

// Normaliza COLUMN_TYPE para comparar: MySQL < 8.0.19 reporta el ancho de display de los enteros
// ("int(11) unsigned"), y desde 8.0.19 no ("int unsigned"). Es el mismo tipo; no es un desajuste.
function normalizarTipo(tipo) {
  return String(tipo).toLowerCase().replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1').replace(/\s+/g, ' ').trim();
}

function tablaYColumnaExisten(columnasMap, tabla, columna) {
  const cols = columnasMap.get(tabla);
  return Boolean(cols && cols.has(columna));
}

async function checkC4(conn, ctx) {
  // usuarios_movimientos.idUsuario (la única relación "auditoria") nunca va a tener FK por
  // diseño (architecture.md §12.3.1) — un mismatch de tipo ahí es informativo, no un hallazgo
  // a corregir: no tiene sentido "arreglar" el tipo de una columna que nunca se va a vincular
  // con FK.
  const clavesAuditoria = new Set(relaciones.auditoria.map(r => `${r.hija}.${r.columna}`));

  const filasTabla = [];
  for (const rel of relaciones.todasLasRelaciones) {
    try {
      const hijaExiste = tablaYColumnaExisten(ctx.columnas, rel.hija, rel.columna);
      const padreExiste = tablaYColumnaExisten(ctx.columnas, rel.padre, rel.columnaPadre);

      if (!hijaExiste || !padreExiste) {
        filasTabla.push([`${rel.hija}.${rel.columna}`, `${rel.padre}.${rel.columnaPadre}`, '—', '—', '—', '(no existe en esta base)']);
        continue;
      }

      const tipoHija = ctx.columnas.get(rel.hija).get(rel.columna).COLUMN_TYPE;
      const tipoPadre = ctx.columnas.get(rel.padre).get(rel.columnaPadre).COLUMN_TYPE;
      const coincide = normalizarTipo(tipoHija) === normalizarTipo(tipoPadre);
      const tieneIdx = tieneIndice(ctx.indices, rel.hija, rel.columna);
      const esAuditoria = clavesAuditoria.has(`${rel.hija}.${rel.columna}`);

      filasTabla.push([
        `${rel.hija}.${rel.columna}`,
        `${rel.padre}.${rel.columnaPadre}`,
        tipoHija,
        tipoPadre,
        ctx.foreignKeys.mapa.has(`${rel.hija}.${rel.columna}`) ? 'sí' : 'no',
        (coincide ? 'OK' : (esAuditoria ? 'DIFIEREN (sin FK por diseño)' : 'DIFIEREN')) + (tieneIdx ? '' : ' · sin índice en hija'),
      ]);

      if (!coincide && !esAuditoria) {
        ctx.reporte.hallazgo(
          `\`${rel.hija}.${rel.columna}\` (${tipoHija}) vs \`${rel.padre}.${rel.columnaPadre}\` (${tipoPadre}) — tipos incompatibles para FK.` +
          (rel.nota ? ` (${rel.nota})` : '')
        );
      } else if (!coincide && esAuditoria) {
        ctx.reporte.linea(
          `\`${rel.hija}.${rel.columna}\` (${tipoHija}) vs \`${rel.padre}.${rel.columnaPadre}\` (${tipoPadre}) — difieren, pero esta relación nunca tiene FK por diseño (${rel.nota}). Informativo, no es hallazgo.`
        );
      }
    } catch (err) {
      ctx.reporte.error(`relación ${rel.hija}.${rel.columna} -> ${rel.padre}.${rel.columnaPadre}: ${err.message}`);
    }
  }
  ctx.reporte.tabla(['Relación', 'Referencia', 'Tipo hija', 'Tipo padre', 'FK existe', 'Resultado'], filasTabla);

  // Columnas id[A-Z]* no cubiertas por relaciones.js (§5: "relación no clasificada").
  const cubiertas = new Set([
    ...relaciones.todasLasRelaciones.map(r => `${r.hija}.${r.columna}`),
    ...relaciones.polimorficas.map(r => `${r.hija}.${r.columna}`),
  ]);
  const noClasificadas = [];
  for (const [tabla, cols] of ctx.columnas) {
    for (const columna of cols.keys()) {
      if (/^id[A-Z]/.test(columna) && !cubiertas.has(`${tabla}.${columna}`)) {
        noClasificadas.push(`${tabla}.${columna}`);
      }
    }
  }
  if (noClasificadas.length > 0) {
    ctx.reporte.linea('');
    ctx.reporte.linea('### Columnas id* sin clasificar');
    ctx.reporte.linea('');
    ctx.reporte.linea('No se adivina a qué tabla apuntan — agregarlas a relaciones.js si corresponde:');
    ctx.reporte.linea('');
    for (const c of noClasificadas.sort()) ctx.reporte.linea(`- ${c}`);
  }
}

// ---------------------------------------------------------------------------
// C5 — Integridad por relación
// ---------------------------------------------------------------------------

async function checkC5(conn, ctx) {
  for (const rel of relaciones.todasLasRelaciones) {
    const hijaExiste = tablaYColumnaExisten(ctx.columnas, rel.hija, rel.columna);
    const padreExiste = tablaYColumnaExisten(ctx.columnas, rel.padre, rel.columnaPadre);
    if (!hijaExiste || !padreExiste) continue; // ya reportado en C4

    ctx.reporte.linea(`### \`${rel.hija}.${rel.columna}\` -> \`${rel.padre}.${rel.columnaPadre}\``);

    try {
      const inicio = Date.now();
      const colId = columnaIdentificadora(ctx.columnas.get(rel.hija), rel.columna);

      const [{ nulos }] = await filas(conn,
        `SELECT COUNT(*) AS nulos FROM \`${rel.hija}\` WHERE \`${rel.columna}\` IS NULL`);
      const [{ ceros }] = await filas(conn,
        `SELECT COUNT(*) AS ceros FROM \`${rel.hija}\` WHERE \`${rel.columna}\` = 0`);
      // Negativos: la migration de 3.1-A alinea el tipo de la hija a UNSIGNED y saltea la columna
      // si hay valores < 0 (no se pueden representar). Hace falta saber si los hay.
      const [{ negativos }] = await filas(conn,
        `SELECT COUNT(*) AS negativos FROM \`${rel.hija}\` WHERE \`${rel.columna}\` < 0`);
      const [{ huerfanos }] = await filas(conn, `
        SELECT COUNT(*) AS huerfanos
        FROM \`${rel.hija}\` h
        WHERE h.\`${rel.columna}\` IS NOT NULL AND h.\`${rel.columna}\` <> 0
          AND NOT EXISTS (SELECT 1 FROM \`${rel.padre}\` p WHERE p.\`${rel.columnaPadre}\` = h.\`${rel.columna}\`)
      `);

      const tomoMucho = Date.now() - inicio > 2000;
      if (tomoMucho) {
        console.warn(`  (lento: ${rel.hija}.${rel.columna} tardó ${Date.now() - inicio}ms — revisar índice en local, es esperable sobre tablas grandes)`);
      }

      ctx.reporte.linea(`- NULL: ${nulos} · = 0: ${ceros} · < 0: ${negativos} · huérfanos: ${huerfanos}`);

      if (Number(negativos) > 0) {
        ctx.reporte.hallazgo(
          `${negativos} fila(s) con valor negativo en \`${rel.hija}.${rel.columna}\` — no entran en una columna UNSIGNED.` +
          (rel.nota ? ` (${rel.nota})` : '')
        );
      }

      if (Number(huerfanos) > 0) {
        const ejemplos = await filas(conn, `
          SELECT h.\`${colId}\` AS ejemplo
          FROM \`${rel.hija}\` h
          WHERE h.\`${rel.columna}\` IS NOT NULL AND h.\`${rel.columna}\` <> 0
            AND NOT EXISTS (SELECT 1 FROM \`${rel.padre}\` p WHERE p.\`${rel.columnaPadre}\` = h.\`${rel.columna}\`)
          LIMIT 20
        `);
        ctx.reporte.hallazgo(
          `${huerfanos} fila(s) huérfana(s) (columna identificadora: \`${colId}\`). Ejemplos: ${ejemplos.map(e => e.ejemplo).join(', ')}` +
          (rel.nota ? ` (${rel.nota})` : '')
        );
      }
    } catch (err) {
      ctx.reporte.error(`${rel.hija}.${rel.columna}: ${err.message}`);
    }
    ctx.reporte.linea('');
  }
}

// ---------------------------------------------------------------------------
// C6 — Registros especiales
// ---------------------------------------------------------------------------

async function checkC6(conn, ctx) {
  // productos.id = 1 -> VARIOS, se asume codigo === '*' (ver ventasRepository.ts:768 y
  // architecture.md §12.7, que además marca este hardcode como prohibido a futuro).
  if (tablaYColumnaExisten(ctx.columnas, 'productos', 'codigo')) {
    const filasProd = await filas(conn, "SELECT codigo FROM productos WHERE id = 1");
    if (filasProd.length === 0) {
      ctx.reporte.hallazgo('no existe `productos.id = 1` (se asume como VARIOS en el código).');
    } else {
      const codigo = filasProd[0].codigo;
      ctx.reporte.linea(`productos.id=1: codigo="${codigo}" — ${codigo === '*' ? 'OK' : 'no es "*"'}`);
      if (codigo !== '*') ctx.reporte.hallazgo('`productos.id=1.codigo` no es "*" (el código asume que sí, ver ventasRepository.ts).');
    }
  } else {
    ctx.reporte.linea('tabla/columna `productos.codigo` no existe en esta base.');
  }

  // tipos_pago.id = 1 -> EFECTIVO (ID_TIPO_PAGO_EFECTIVO en cuentasCorsRepository.ts).
  if (tablaYColumnaExisten(ctx.columnas, 'tipos_pago', 'nombre')) {
    const filasTp = await filas(conn, 'SELECT nombre FROM tipos_pago WHERE id = 1');
    if (filasTp.length === 0) {
      ctx.reporte.hallazgo('no existe `tipos_pago.id = 1` (se asume EFECTIVO en el código: ID_TIPO_PAGO_EFECTIVO).');
    } else {
      const nombre = filasTp[0].nombre;
      ctx.reporte.linea(`tipos_pago.id=1: nombre="${nombre}" — ${nombre === 'EFECTIVO' ? 'OK' : 'no es "EFECTIVO"'}`);
      if (nombre !== 'EFECTIVO') ctx.reporte.hallazgo('`tipos_pago.id=1.nombre` no es "EFECTIVO" (ID_TIPO_PAGO_EFECTIVO asume que sí).');
    }
  } else {
    ctx.reporte.linea('tabla/columna `tipos_pago.nombre` no existe en esta base.');
  }

  // clientes.id = 1 -> CONSUMIDOR FINAL. Solo se informa sí/no, nunca el nombre real (puede
  // ser el de un cliente identificable si la instalación no siguió la convención).
  if (tablaYColumnaExisten(ctx.columnas, 'clientes', 'nombre')) {
    const filasCli = await filas(conn, 'SELECT nombre FROM clientes WHERE id = 1');
    if (filasCli.length === 0) {
      ctx.reporte.hallazgo('no existe `clientes.id = 1`.');
    } else {
      const esConsumidorFinal = filasCli[0].nombre === 'CONSUMIDOR FINAL';
      ctx.reporte.linea(`clientes.id=1 es "CONSUMIDOR FINAL": ${esConsumidorFinal ? 'sí' : 'no'}`);
      if (!esConsumidorFinal) ctx.reporte.hallazgo('`clientes.id=1` no es "CONSUMIDOR FINAL".');
    }
  } else {
    ctx.reporte.linea('tabla/columna `clientes.nombre` no existe en esta base.');
  }

  // cargos 1..3 -> ADMINISTRADOR, ENCARGADO, EMPLEADO (orden de inserción en el bootstrap).
  if (tablaYColumnaExisten(ctx.columnas, 'cargos', 'nombre')) {
    const esperados = { 1: 'ADMINISTRADOR', 2: 'ENCARGADO', 3: 'EMPLEADO' };
    const filasCargos = await filas(conn, 'SELECT id, nombre FROM cargos WHERE id IN (1,2,3)');
    const porId = new Map(filasCargos.map(r => [r.id, r.nombre]));
    for (const id of [1, 2, 3]) {
      const real = porId.get(id);
      const ok = real === esperados[id];
      ctx.reporte.linea(`cargos.id=${id}: ${real == null ? '(no existe)' : `nombre="${real}"`} — ${ok ? 'OK' : `esperado "${esperados[id]}"`}`);
      if (!ok) ctx.reporte.hallazgo(`cargos.id=${id} no es "${esperados[id]}" (real: ${real == null ? 'no existe' : real}).`);
    }
  } else {
    ctx.reporte.linea('tabla/columna `cargos.nombre` no existe en esta base.');
  }
}

// ---------------------------------------------------------------------------
// C7 — Duplicados
// ---------------------------------------------------------------------------

async function checkC7(conn, ctx) {
  if (tablaYColumnaExisten(ctx.columnas, 'productos', 'codigo')) {
    const tieneFechaBaja = tablaYColumnaExisten(ctx.columnas, 'productos', 'fechaBaja');
    const condicion = tieneFechaBaja ? 'WHERE fechaBaja IS NULL' : '';
    const dup = await filas(conn, `
      SELECT COUNT(*) AS codigosDuplicados, MAX(c) AS maxRepeticiones FROM (
        SELECT codigo, COUNT(*) AS c FROM productos ${condicion} GROUP BY codigo HAVING c > 1
      ) t
    `);
    const { codigosDuplicados, maxRepeticiones } = dup[0];
    ctx.reporte.linea(`productos.codigo duplicado (${tieneFechaBaja ? 'entre activos' : 'sin campo fechaBaja, sobre todos'}): ${codigosDuplicados || 0} código(s), máximo ${maxRepeticiones || 0} repeticiones.`);
    if (Number(codigosDuplicados) > 0) {
      ctx.reporte.hallazgo(`${codigosDuplicados} código(s) de producto duplicados (máx ${maxRepeticiones} repeticiones).`);
    }
  } else {
    ctx.reporte.linea('tabla/columna `productos.codigo` no existe en esta base.');
  }

  if (tablaYColumnaExisten(ctx.columnas, 'clientes', 'nroDocumento')) {
    const dup = await filas(conn, `
      SELECT COUNT(*) AS documentosDuplicados, MAX(c) AS maxRepeticiones FROM (
        SELECT nroDocumento, COUNT(*) AS c FROM clientes WHERE nroDocumento IS NOT NULL GROUP BY nroDocumento HAVING c > 1
      ) t
    `);
    const { documentosDuplicados, maxRepeticiones } = dup[0];
    ctx.reporte.linea(`clientes.nroDocumento duplicado: ${documentosDuplicados || 0} documento(s), máximo ${maxRepeticiones || 0} repeticiones.`);
    if (Number(documentosDuplicados) > 0) {
      ctx.reporte.hallazgo(`${documentosDuplicados} documento(s) de cliente duplicados (máx ${maxRepeticiones} repeticiones).`);
    }
  } else {
    ctx.reporte.linea('columna `clientes.nroDocumento` no existe en esta base (instalación sin datos fiscales de clientes).');
  }
}

// ---------------------------------------------------------------------------
// C8 — Índices de architecture.md §12.2
// ---------------------------------------------------------------------------

const INDICES_ESPERADOS = [
  ['ventas', 'idCaja'], ['ventas', 'idCliente'], ['ventas', 'fecha'],
  ['ventas_detalle', 'idVenta'], ['ventas_detalle', 'idProducto'],
  ['ventas_pago', 'idVenta'],
  ['ventas_pagos_detalle', 'idVenta'],
  ['cajas', 'idResponsable'], ['cajas', 'fecha'],
  ['cajas_movimientos', 'idCaja'],
  ['productos', 'codigo'], ['productos', 'idCategoria'],
  ['eventos', 'puesto_id'], ['eventos', 'usuario_id'], ['eventos', 'fecha'], ['eventos', 'entidad'],
  ['puestos', 'ultimo_visto'],
];

async function checkC8(conn, ctx) {
  const filasTabla = [];
  for (const [tabla, columna] of INDICES_ESPERADOS) {
    if (!tablaYColumnaExisten(ctx.columnas, tabla, columna)) {
      filasTabla.push([`${tabla}.${columna}`, '(no existe en esta base)']);
      continue;
    }
    const tieneIdx = tieneIndice(ctx.indices, tabla, columna);
    filasTabla.push([`${tabla}.${columna}`, tieneIdx ? 'tiene índice' : 'SIN ÍNDICE']);
    if (!tieneIdx) {
      ctx.reporte.hallazgo(`\`${tabla}.${columna}\` está en el conjunto mínimo de architecture.md §12.2 y no tiene índice.`);
    }
  }
  ctx.reporte.tabla(['Columna', 'Estado'], filasTabla);
}

// ---------------------------------------------------------------------------
// C9 — Pre-conciliación de caja (solo medir)
// ---------------------------------------------------------------------------

async function checkC9(conn, ctx) {
  if (!tablaYColumnaExisten(ctx.columnas, 'ventas', 'total')) {
    ctx.reporte.linea('columna `ventas.total` no existe en esta base (instalación anterior a la migration que la agrega) — check omitido.');
    return;
  }

  const [{ nulos, ceros }] = await filas(conn, `
    SELECT
      SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END) AS nulos,
      SUM(CASE WHEN total = 0 THEN 1 ELSE 0 END) AS ceros
    FROM ventas
  `);
  ctx.reporte.linea(`ventas.total NULL: ${nulos || 0} · = 0: ${ceros || 0} (total, todos los años)`);

  const porAnio = await filas(conn, `
    SELECT YEAR(fecha) AS anio,
           SUM(CASE WHEN total IS NULL THEN 1 ELSE 0 END) AS nulos,
           SUM(CASE WHEN total = 0 THEN 1 ELSE 0 END) AS ceros
    FROM ventas
    GROUP BY YEAR(fecha)
    ORDER BY anio
  `);
  ctx.reporte.tabla(['Año', 'NULL', '= 0'], porAnio.map(r => [r.anio ?? '(sin fecha)', r.nulos || 0, r.ceros || 0]));

  if (Number(nulos) > 0 || Number(ceros) > 0) {
    ctx.reporte.hallazgo(`${nulos || 0} venta(s) con total NULL y ${ceros || 0} con total = 0.`);
  }

  const cajasCols = ctx.columnas.get('cajas');
  if (!cajasCols || !cajasCols.has('finalizada') || !cajasCols.has('ventas')) {
    ctx.reporte.linea('`cajas.finalizada` y/o `cajas.ventas` no existen en esta base — se omite la comparación por caja.');
    return;
  }

  const porCaja = await filas(conn, `
    SELECT c.id, c.fecha, c.ventas AS ventasDeclaradas,
           COALESCE(SUM(v.total), 0) AS ventasCalculadas
    FROM cajas c
    LEFT JOIN ventas v ON v.idCaja = c.id AND v.fechaBaja IS NULL
    WHERE c.finalizada = 1
    GROUP BY c.id, c.fecha, c.ventas
  `);

  let cuantasDanCero = 0;
  let cuantasDanDistinto = 0;
  let sumaAbsolutaDiferencias = 0;
  const porAnioDif = new Map();

  for (const c of porCaja) {
    const diferencia = Number(c.ventasDeclaradas || 0) - Number(c.ventasCalculadas || 0);
    if (diferencia === 0) cuantasDanCero++; else cuantasDanDistinto++;
    sumaAbsolutaDiferencias += Math.abs(diferencia);

    const anio = c.fecha ? new Date(c.fecha).getFullYear() : 'sin fecha';
    porAnioDif.set(anio, (porAnioDif.get(anio) || 0) + Math.abs(diferencia));
  }

  ctx.reporte.linea(`Cajas finalizadas analizadas: ${porCaja.length}`);
  ctx.reporte.linea(`- dan 0 de diferencia: ${cuantasDanCero}`);
  ctx.reporte.linea(`- dan distinto de 0: ${cuantasDanDistinto}`);
  ctx.reporte.linea(`- suma absoluta de diferencias: ${sumaAbsolutaDiferencias.toFixed(2)}`);
  ctx.reporte.linea('');
  ctx.reporte.tabla(['Año', 'Suma absoluta de diferencias'],
    [...porAnioDif.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([anio, suma]) => [anio, suma.toFixed(2)]));

  if (cuantasDanDistinto > 0) {
    ctx.reporte.hallazgo(`${cuantasDanDistinto} caja(s) finalizada(s) con \`cajas.ventas\` distinto de la suma de \`ventas.total\`. No se define ni corrige acá qué debería ir en cajas.ventas (decisión de negocio, 3.4).`);
  }
}

// ---------------------------------------------------------------------------
// C10 — Stock
// ---------------------------------------------------------------------------

async function checkC10(conn, ctx) {
  const cols = ctx.columnas.get('productos');
  if (!cols) {
    ctx.reporte.linea('tabla `productos` no existe en esta base.');
    return;
  }

  const tieneFechaBaja = cols.has('fechaBaja');
  const condicionActivos = tieneFechaBaja ? 'WHERE fechaBaja IS NULL' : '';
  const [{ activos }] = await filas(conn, `SELECT COUNT(*) AS activos FROM productos ${condicionActivos}`);
  ctx.reporte.linea(`Productos activos${tieneFechaBaja ? '' : ' (sin campo fechaBaja en esta base, se cuentan todos)'}: ${activos}`);

  if (cols.has('cantidad')) {
    const [{ negativos }] = await filas(conn, `SELECT COUNT(*) AS negativos FROM productos ${condicionActivos ? condicionActivos + ' AND' : 'WHERE'} cantidad < 0`);
    ctx.reporte.linea(`Con cantidad < 0: ${negativos}`);
    if (Number(negativos) > 0) ctx.reporte.hallazgo(`${negativos} producto(s) activo(s) con cantidad negativa.`);

    if (cols.has('unidad')) {
      const [{ decimalesNoKg }] = await filas(conn, `
        SELECT COUNT(*) AS decimalesNoKg FROM productos
        WHERE (unidad IS NULL OR unidad <> 'KG') AND cantidad <> FLOOR(cantidad)
      `);
      ctx.reporte.linea(`Con cantidad decimal en unidad distinta de KG: ${decimalesNoKg}`);
      if (Number(decimalesNoKg) > 0) ctx.reporte.hallazgo(`${decimalesNoKg} producto(s) con cantidad decimal fuera de unidad KG.`);
    } else {
      ctx.reporte.linea('columna `productos.unidad` no existe en esta base.');
    }

    if (cols.has('soloPrecio')) {
      const [{ soloPrecioConCantidad }] = await filas(conn, `
        SELECT COUNT(*) AS soloPrecioConCantidad FROM productos WHERE soloPrecio = 1 AND cantidad <> 0
      `);
      ctx.reporte.linea(`Con soloPrecio=1 y cantidad<>0: ${soloPrecioConCantidad}`);
      if (Number(soloPrecioConCantidad) > 0) ctx.reporte.hallazgo(`${soloPrecioConCantidad} producto(s) con soloPrecio=1 y cantidad<>0 (debería ser siempre 0).`);
    } else {
      ctx.reporte.linea('columna `productos.soloPrecio` no existe en esta base.');
    }
  } else {
    ctx.reporte.linea('columna `productos.cantidad` no existe en esta base.');
  }

  if (tablaYColumnaExisten(ctx.columnas, 'ventas_detalle', 'idVenta') && tablaYColumnaExisten(ctx.columnas, 'ventas', 'fecha')) {
    const porAnio = await filas(conn, `
      SELECT YEAR(v.fecha) AS anio, COUNT(*) AS filas
      FROM ventas_detalle vd
      JOIN ventas v ON v.id = vd.idVenta
      GROUP BY YEAR(v.fecha)
      ORDER BY anio
    `);
    ctx.reporte.linea('');
    ctx.reporte.linea('Filas de `ventas_detalle` por año (volumen para estimar el costo de los ALTER de 3.5):');
    ctx.reporte.tabla(['Año', 'Filas'], porAnio.map(r => [r.anio ?? '(sin fecha)', r.filas]));
  }
}

// ---------------------------------------------------------------------------
// C11 — Foreign keys existentes
// ---------------------------------------------------------------------------

async function checkC11(conn, ctx) {
  const { rows, mapa } = ctx.foreignKeys;

  ctx.reporte.linea(`${rows.length} FK(s) en la base.`);
  ctx.reporte.linea('');
  ctx.reporte.tabla(
    ['Tabla', 'Columna', 'Padre', 'DELETE_RULE', 'Constraint'],
    rows.map(r => [r.tabla, r.columna, `${r.tablaReferenciada}.${r.columnaReferenciada}`, r.reglaBorrado, r.nombre])
  );

  // FKs que alguna migration de src/db/tasks declara (relaciones.conFk) y que acá no existen.
  // Se omiten las relaciones cuya tabla o columna no existe en esta base (backup viejo): eso ya
  // lo reporta C4 / C2.
  ctx.reporte.linea('### FKs declaradas por migrations (relaciones.conFk)');
  ctx.reporte.linea('');
  const filasEstado = [];
  for (const rel of relaciones.conFk) {
    if (!tablaYColumnaExisten(ctx.columnas, rel.hija, rel.columna) ||
        !tablaYColumnaExisten(ctx.columnas, rel.padre, rel.columnaPadre)) {
      filasEstado.push([`${rel.hija}.${rel.columna}`, `${rel.padre}.${rel.columnaPadre}`, '(no existe en esta base)']);
      continue;
    }
    const existe = mapa.has(`${rel.hija}.${rel.columna}`);
    filasEstado.push([`${rel.hija}.${rel.columna}`, `${rel.padre}.${rel.columnaPadre}`, existe ? 'sí' : 'NO']);
    if (!existe) {
      ctx.reporte.hallazgo(`\`${rel.hija}.${rel.columna}\` -> \`${rel.padre}.${rel.columnaPadre}\`: una migration la declara pero la FK no existe en esta base.`);
    }
  }
  ctx.reporte.tabla(['Relación', 'Padre', 'FK existe'], filasEstado);
}

// ---------------------------------------------------------------------------
// C12 — Caja (Fase 3.4-0, ver documentos/handoff_fase3_4_0_diagnostico_caja.md)
// ---------------------------------------------------------------------------
// Mide, sobre backups reales, cuánto explica cada causa conocida de que las cajas no cierren
// (K1 cobros de fiado en la caja de la venta original, K2 NC total que no descuenta
// cajas.ventas, K3 bugs históricos de anulación) y cómo distinguir en datos viejos un cobro
// posterior de un pago original en ventas_pagos_detalle. Solo SELECT.

const FECHA_DEPLOY_3_2_0 = '2026-10-21';  // deploy del fix de anulación (3.2-0)
const UMBRAL_BACKFILL = 10;               // filas de ventas distintas con la MISMA fecha exacta
const TOLERANCIA = 0.01;
const SEG_10_MIN = 600;

function redondear2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

// Fragmentos SQL compartidos por C12.1-C12.3. Si falta una tabla/columna (instalación vieja),
// la regla correspondiente se reemplaza por una constante 0 en vez de romper la query.
function fragmentosCaja(ctx) {
  const tiene = (t, c) => tablaYColumnaExisten(ctx.columnas, t, c);
  const tieneEntrega = tiene('ventas_pagos_detalle', 'idEntrega');
  const tieneIdCaja = tiene('ventas_pagos_detalle', 'idCaja');
  const tieneLedger = tiene('cuenta_corriente_movimientos', 'idReferencia') && tiene('cuenta_corriente_movimientos', 'descripcion');
  const tieneNc = tiene('notas_credito', 'esParcial');

  // R3: el pago completo (ActualizarEstadoPago) escribe en el ledger tipo='ajuste',
  // descripcion='Pago manual de venta', idReferencia=idVenta, haber=total. NO es tipo='entrega'
  // con idReferencia=idVenta como suponía el handoff: EntregaDinero escribe tipo='entrega' pero
  // con idReferencia=idEntrega (esas filas ya son R1). Además se exige que sea la ÚLTIMA fila de
  // ventas_pagos_detalle de la venta, porque la fila del pago original puede tener el mismo
  // monto (misma desambiguación que usa cuentasCorsRepository.ObtenerCobrosCaja).
  const joinLedger = tieneLedger
    ? `LEFT JOIN (SELECT idReferencia, haber FROM cuenta_corriente_movimientos
                   WHERE tipo = 'ajuste' AND descripcion = 'Pago manual de venta'
                   GROUP BY idReferencia, haber) l3
         ON l3.idReferencia = vpd.idVenta AND l3.haber = vpd.monto
       LEFT JOIN (SELECT idVenta, MAX(id) AS maxId FROM ventas_pagos_detalle GROUP BY idVenta) lm
         ON lm.idVenta = vpd.idVenta`
    : '';
  const joinNc = tieneNc
    ? 'LEFT JOIN (SELECT DISTINCT idVenta FROM notas_credito WHERE esParcial = 0) nct ON nct.idVenta = v.id'
    : '';

  const r1 = tieneEntrega ? '(vpd.idEntrega IS NOT NULL)' : '0';
  const r2 = tieneIdCaja ? '(vpd.idCaja IS NOT NULL)' : '0';
  const r3 = tieneLedger ? 'COALESCE(l3.idReferencia IS NOT NULL AND vpd.id = lm.maxId, 0)' : '0';
  const r3lax = tieneLedger ? '(l3.idReferencia IS NOT NULL)' : '0';
  return {
    tieneEntrega, tieneIdCaja, tieneLedger, tieneNc,
    joinLedger, joinNc, r1, r2, r3, r3lax,
    r123: `(${r1} OR ${r2} OR ${r3})`,
    ncTotal: tieneNc ? '(nct.idVenta IS NOT NULL)' : '0',
  };
}

function tramoDe(bucket) {
  return ({
    antes: 'antes de la venta (< -1 min)',
    m1: '< 1 min',
    m10: '1 – 10 min',
    h1: '10 min – 1 h',
    d1: '1 h – 1 día',
    mas: '> 1 día',
    sin_dato: 'sin fecha/hora comparable',
  })[bucket] || bucket;
}

const ORDEN_TRAMOS = ['antes', 'm1', 'm10', 'h1', 'd1', 'mas', 'sin_dato'];

async function checkC12_1(conn, ctx, f) {
  const R = ctx.reporte;
  R.linea('### C12.1 Clasificación de `ventas_pagos_detalle`');
  R.linea('');
  if (!tablaYColumnaExisten(ctx.columnas, 'ventas_pagos_detalle', 'idVenta') || !tablaYColumnaExisten(ctx.columnas, 'ventas', 'id')) {
    R.linea('`ventas_pagos_detalle` o `ventas` no existen en esta base — sección omitida.');
    R.linea('');
    return;
  }
  R.linea('Reglas (una fila puede caer en varias):');
  R.linea('- R1: `idEntrega IS NOT NULL`' + (f.tieneEntrega ? '' : ' — **columna inexistente en esta base**'));
  R.linea('- R2: `idCaja IS NOT NULL`' + (f.tieneIdCaja ? '' : ' — **columna inexistente en esta base**'));
  R.linea('- R3: ledger `cuenta_corriente_movimientos` con `tipo=\'ajuste\'`, `descripcion=\'Pago manual de venta\'`, `idReferencia = vpd.idVenta`, `haber = vpd.monto`, y `vpd` es la última fila de esa venta (ver comentario en `fragmentosCaja`)' + (f.tieneLedger ? '' : ' — **ledger inexistente en esta base**'));
  R.linea('- R4: `vpd.fecha` posterior en más de 10 min a `TIMESTAMP(v.fecha, v.hora)` (se excluyen las filas del backfill)');
  R.linea('- R0: ninguna de las anteriores (presunto pago original)');
  R.linea('');

  // Backfill de la migration 20260319122913: el INSERT ... SELECT corre con una sola NOW(),
  // así que todas sus filas comparten fecha exacta y no tienen idEntrega/idCaja (esas columnas
  // se agregaron después). Se detectan como "fecha exacta compartida por >= UMBRAL_BACKFILL
  // ventas distintas, sin marcas". Se contrasta con knex_migrations.migration_time.
  const sinMarcas = [f.tieneEntrega ? 'vpd.idEntrega IS NULL' : '1=1', f.tieneIdCaja ? 'vpd.idCaja IS NULL' : '1=1'].join(' AND ');
  const candidatas = await filas(conn,
    `SELECT DATE_FORMAT(vpd.fecha, '%Y-%m-%d %H:%i:%s') AS f, COUNT(*) AS filas, COUNT(DISTINCT vpd.idVenta) AS ventas
     FROM ventas_pagos_detalle vpd
     WHERE vpd.fecha IS NOT NULL AND ${sinMarcas}
     GROUP BY vpd.fecha
     HAVING COUNT(DISTINCT vpd.idVenta) >= ${UMBRAL_BACKFILL}
     ORDER BY vpd.fecha`);

  let migracionTime = null;
  try {
    const mig = await filas(conn,
      "SELECT DATE_FORMAT(migration_time, '%Y-%m-%d %H:%i:%s') AS t FROM knex_migrations WHERE name LIKE '20260319122913%' LIMIT 1");
    migracionTime = mig[0] ? mig[0].t : null;
  } catch (err) {
    R.linea(`(no pude leer knex_migrations: ${err.message})`);
  }

  if (candidatas.length === 0) {
    R.linea(`Backfill de la migration \`20260319122913_ventas_pagos_detalle\`: no se detectaron filas (ninguna fecha exacta compartida por ${UMBRAL_BACKFILL}+ ventas sin marcas).`);
  } else {
    R.linea(`Backfill de la migration \`20260319122913_ventas_pagos_detalle\` (migration_time en knex_migrations: ${migracionTime || 'no registrada'}). Fechas exactas compartidas por ${UMBRAL_BACKFILL}+ ventas distintas, sin idEntrega/idCaja:`);
    R.linea('');
    R.tabla(['Fecha exacta', 'Filas', 'Ventas distintas', 'Distancia a migration_time'],
      candidatas.map(c => {
        let dist = 'n/d';
        if (migracionTime) {
          const horas = Math.abs(Date.parse(c.f.replace(' ', 'T') + 'Z') - Date.parse(migracionTime.replace(' ', 'T') + 'Z')) / 3600000;
          dist = `${horas.toFixed(1)} h${horas <= 24 ? ' (coincide)' : ' (NO coincide — revisar)'}`;
        }
        return [c.f, c.filas, c.ventas, dist];
      }));
  }
  const fechasBackfill = candidatas.map(c => c.f);
  const backfillSql = fechasBackfill.length > 0
    ? `(vpd.fecha IN (${fechasBackfill.map(x => conn.escape(x)).join(',')}) AND ${sinMarcas})`
    : '0';

  const base = `
    SELECT COALESCE(YEAR(v.fecha), YEAR(vpd.fecha)) AS anio, vpd.id AS id,
           ${f.r1} AS r1, ${f.r2} AS r2, ${f.r3} AS r3, ${f.r3lax} AS r3lax, ${backfillSql} AS backfill,
           TIMESTAMPDIFF(SECOND, TIMESTAMP(v.fecha, COALESCE(NULLIF(v.hora, ''), '00:00:00')), vpd.fecha) AS difSeg
    FROM ventas_pagos_detalle vpd
    LEFT JOIN ventas v ON v.id = vpd.idVenta
    ${f.joinLedger}`;

  const agrupado = await filas(conn, `
    SELECT anio, r1, r2, r3, r3lax, backfill,
           CASE WHEN difSeg IS NULL THEN 'sin_dato'
                WHEN difSeg < -60 THEN 'antes'
                WHEN difSeg < 60 THEN 'm1'
                WHEN difSeg <= ${SEG_10_MIN} THEN 'm10'
                WHEN difSeg <= 3600 THEN 'h1'
                WHEN difSeg <= 86400 THEN 'd1'
                ELSE 'mas' END AS tramo,
           COUNT(*) AS n
    FROM (${base}) t
    GROUP BY anio, r1, r2, r3, r3lax, backfill, tramo`);

  const porAnio = new Map();
  const combos = new Map();
  const tramosTodas = new Map();
  const tramosDudosas = new Map();
  let total = 0, dudosas = 0, r3Lax = 0, r3Estricta = 0, backfillN = 0;
  const sumar = (m, k, n) => m.set(k, (m.get(k) || 0) + n);

  for (const g of agrupado) {
    const n = Number(g.n);
    const backfill = Number(g.backfill) === 1;
    const r1 = Number(g.r1) === 1, r2 = Number(g.r2) === 1, r3 = Number(g.r3) === 1;
    const r4 = !backfill && ['h1', 'd1', 'mas'].includes(g.tramo);
    const r0 = !r1 && !r2 && !r3 && !r4;
    const dudosa = r4 && !r1 && !r2 && !r3;
    const anio = g.anio ?? 'sin fecha';

    if (!porAnio.has(anio)) porAnio.set(anio, { total: 0, r1: 0, r2: 0, r3: 0, r4: 0, r0: 0, backfill: 0, dudosas: 0 });
    const a = porAnio.get(anio);
    a.total += n;
    if (r1) a.r1 += n;
    if (r2) a.r2 += n;
    if (r3) a.r3 += n;
    if (r4) a.r4 += n;
    if (r0) a.r0 += n;
    if (backfill) a.backfill += n;
    if (dudosa) a.dudosas += n;

    total += n;
    if (backfill) backfillN += n;
    if (dudosa) dudosas += n;
    if (Number(g.r3lax) === 1) r3Lax += n;
    if (r3) r3Estricta += n;

    const clave = [r1 && 'R1', r2 && 'R2', r3 && 'R3', r4 && 'R4'].filter(Boolean).join('+') || 'R0';
    sumar(combos, clave, n);
    if (!backfill) sumar(tramosTodas, g.tramo, n);
    if (dudosa) sumar(tramosDudosas, g.tramo, n);
  }

  R.linea(`Filas totales en \`ventas_pagos_detalle\`: ${total}`);
  R.linea('');
  R.linea('**Conteo por clase y por año** (no excluyentes; "R0" incluye las filas de backfill; "Backfill" se cuenta aparte):');
  R.linea('');
  R.tabla(['Año', 'Total', 'R1', 'R2', 'R3', 'R4', 'R0', 'Backfill', 'Dudosas (R4 sin R1/R2/R3)'],
    [...porAnio.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .map(([anio, a]) => [anio, a.total, a.r1, a.r2, a.r3, a.r4, a.r0, a.backfill, a.dudosas]));

  R.linea('**Solapamientos entre reglas:**');
  R.linea('');
  R.tabla(['Combinación', 'Filas'], [...combos.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => [k, n]));

  R.linea('**Distribución de `vpd.fecha − (v.fecha + v.hora)`** (sin backfill). "Dudosas" = R4 sin R1/R2/R3:');
  R.linea('');
  R.tabla(['Tramo', 'Todas las filas', 'Dudosas'],
    ORDEN_TRAMOS.filter(t => tramosTodas.has(t) || tramosDudosas.has(t)).map(t => [tramoDe(t), tramosTodas.get(t) || 0, tramosDudosas.get(t) || 0]));

  R.linea(`R3 estricta (última fila de la venta): ${r3Estricta} · R3 laxa (cualquier fila con mismo idVenta+monto en el ledger): ${r3Lax}` +
    (r3Lax !== r3Estricta ? ` — la diferencia (${r3Lax - r3Estricta}) son filas de pago original con el mismo monto que un pago manual posterior.` : ''));
  R.linea('');

  if (backfillN > 0) {
    R.linea(`Filas de backfill (fecha = momento de la migration, no de la venta; R4 las clasificaría mal): ${backfillN}`);
    R.linea('');
  }

  if (dudosas > 0) {
    const muestra = await filas(conn, `
      SELECT id FROM (${base}) t
      WHERE backfill = 0 AND r1 = 0 AND r2 = 0 AND r3 = 0 AND difSeg > ${SEG_10_MIN}
      ORDER BY id LIMIT 20`);
    R.linea(`Muestra de ids dudosos (máx. 20): ${muestra.map(m => m.id).join(', ')}`);
    R.linea('');
    R.hallazgo(`${dudosas} fila(s) de \`ventas_pagos_detalle\` son R4 sin R1/R2/R3: >10 min después de la venta pero sin marca que las identifique como cobro. Son los casos dudosos para la regla de la migration 3.4-A.`);
  }
}

async function checkC12_2(conn, ctx, f) {
  const R = ctx.reporte;
  R.linea('### C12.2 Efectivo por caja: fórmula actual vs. fórmula nueva');
  R.linea('');
  const requeridas = [['cajas', 'finalizada'], ['ventas', 'idCaja'], ['ventas_pagos_detalle', 'monto'], ['ventas_pago', 'idVenta'], ['tipos_pago', 'nombre']];
  const faltan = requeridas.filter(([t, c]) => !tablaYColumnaExisten(ctx.columnas, t, c)).map(([t, c]) => `${t}.${c}`);
  if (faltan.length > 0) {
    R.linea(`Faltan ${faltan.join(', ')} en esta base — sección omitida.`);
    R.linea('');
    return;
  }

  // efectivoActual replica estadisticasRepository.TotalesXTipoPago filtrando por caja:
  // v.fechaBaja IS NULL y c.fechaBaja IS NULL, mismos JOINs (incluido ventas_pago).
  // efectivoNuevo: excluye R1/R2/R3 y cuenta la venta si no tiene baja o tiene NC total.
  const porCaja = await filas(conn, `
    SELECT c.id AS idCaja, DATE_FORMAT(c.fecha, '%Y-%m') AS mes,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NULL THEN vpd.monto END), 0) AS efectivoActual,
           COALESCE(SUM(CASE WHEN (v.fechaBaja IS NULL OR ${f.ncTotal}) AND NOT ${f.r123} THEN vpd.monto END), 0) AS efectivoNuevo,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NULL AND ${f.r123} THEN vpd.monto END), 0) AS cobrosExcluidos,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NOT NULL AND ${f.ncTotal} AND NOT ${f.r123} THEN vpd.monto END), 0) AS ncRecuperado
    FROM cajas c
    INNER JOIN ventas v ON v.idCaja = c.id
    INNER JOIN ventas_pagos_detalle vpd ON vpd.idVenta = v.id
    INNER JOIN ventas_pago vpag ON vpag.idVenta = v.id
    INNER JOIN tipos_pago tp ON tp.id = vpd.idTPago AND tp.nombre = 'EFECTIVO'
    ${f.joinLedger}
    ${f.joinNc}
    WHERE c.finalizada = 1 AND c.fechaBaja IS NULL
    GROUP BY c.id, c.fecha`);
  const finalizadasPorMes = await filas(conn, `
    SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COUNT(*) AS n
    FROM cajas WHERE finalizada = 1 AND fechaBaja IS NULL GROUP BY mes`);
  const [{ bajas }] = await filas(conn, 'SELECT COUNT(*) AS bajas FROM cajas WHERE finalizada = 1 AND fechaBaja IS NOT NULL');

  const porMes = new Map();
  for (const m of finalizadasPorMes) porMes.set(m.mes ?? 'sin fecha', { cajas: Number(m.n), difieren: 0, sumaAbs: 0, cobros: 0, nc: 0 });
  const totalCajas = finalizadasPorMes.reduce((acc, m) => acc + Number(m.n), 0);

  let difieren = 0, sumaAbs = 0, identidadRota = 0;
  for (const c of porCaja) {
    const actual = redondear2(c.efectivoActual);
    const nuevo = redondear2(c.efectivoNuevo);
    const dif = redondear2(nuevo - actual);
    // nuevo = actual − cobrosExcluidos + ncRecuperado: si no cierra, la query está mal.
    if (Math.abs(redondear2(actual - c.cobrosExcluidos + Number(c.ncRecuperado)) - nuevo) > TOLERANCIA) identidadRota++;
    if (Math.abs(dif) < TOLERANCIA) continue;
    difieren++;
    sumaAbs += Math.abs(dif);
    const mes = c.mes ?? 'sin fecha';
    if (!porMes.has(mes)) porMes.set(mes, { cajas: 0, difieren: 0, sumaAbs: 0, cobros: 0, nc: 0 });
    const m = porMes.get(mes);
    m.difieren++;
    m.sumaAbs += Math.abs(dif);
    m.cobros += Number(c.cobrosExcluidos);
    m.nc += Number(c.ncRecuperado);
  }

  R.linea(`Cajas finalizadas analizadas (sin baja): ${totalCajas}${Number(bajas) > 0 ? ` · finalizadas dadas de baja, excluidas igual que en \`TotalesXTipoPago\`: ${bajas}` : ''}`);
  R.linea(`- cajas donde \`efectivoNuevo\` ≠ \`efectivoActual\`: ${difieren}`);
  R.linea(`- suma absoluta de diferencias: ${redondear2(sumaAbs).toFixed(2)}`);
  R.linea('');
  R.tabla(['Mes', 'Cajas finalizadas', 'Difieren', 'Suma abs. dif.', 'Cobros excluidos (K1)', 'NC total recuperadas (K2)'],
    [...porMes.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .map(([mes, m]) => [mes, m.cajas, m.difieren, m.sumaAbs.toFixed(2), m.cobros.toFixed(2), m.nc.toFixed(2)]));
  R.linea('Las dos últimas columnas suman, por mes, lo que explica cada causa en las cajas que difieren: `nuevo = actual − cobros excluidos + NC total recuperadas`.');
  R.linea('');
  if (identidadRota > 0) {
    R.hallazgo(`${identidadRota} caja(s) donde \`nuevo ≠ actual − cobros + NC\`: error de la propia query de diagnóstico, no de los datos. No confiar en esta sección hasta revisarlo.`, { critico: true });
  }
  if (difieren > 0) {
    R.hallazgo(`${difieren} caja(s) finalizada(s) donde el efectivo cambia con la fórmula nueva.`);
  }
}

async function checkC12_3(conn, ctx, f) {
  const R = ctx.reporte;
  R.linea('### C12.3 Acumulador `cajas.ventas` vs. recalculado');
  R.linea('');
  const requeridas = [['cajas', 'ventas'], ['cajas', 'finalizada'], ['ventas', 'total'], ['ventas', 'idCaja']];
  const faltan = requeridas.filter(([t, c]) => !tablaYColumnaExisten(ctx.columnas, t, c)).map(([t, c]) => `${t}.${c}`);
  if (faltan.length > 0) {
    R.linea(`Faltan ${faltan.join(', ')} en esta base — sección omitida.`);
    R.linea('');
    return;
  }

  R.linea('Se miden dos diferencias, porque la regla del handoff y la de C9 responden preguntas distintas:');
  R.linea('- **difA** = `cajas.ventas` − suma de ventas **sin baja** (criterio de C9). Acá K2 aparece como suma de NC totales y la anulación sin descontar como suma de anuladas.');
  R.linea('- **difB** = `cajas.ventas` − suma de ventas **sin baja o con NC total** (regla nueva de la 3.4). Si el código fuera consistente debería dar 0; lo que quede es acumulador roto (p. ej. doble anulación → negativo).');
  R.linea('');

  const cajas = await filas(conn, `
    SELECT c.id AS idCaja, DATE_FORMAT(c.fecha, '%Y-%m') AS mes, DATE_FORMAT(c.fecha, '%Y-%m-%d') AS dia,
           COALESCE(c.ventas, 0) AS declarado,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NULL THEN v.total END), 0) AS sinBaja,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NOT NULL AND ${f.ncTotal} THEN v.total END), 0) AS sumNc,
           COALESCE(SUM(CASE WHEN v.fechaBaja IS NOT NULL AND NOT ${f.ncTotal} THEN v.total END), 0) AS sumAnuladas
    FROM cajas c
    LEFT JOIN ventas v ON v.idCaja = c.id
    ${f.joinNc}
    WHERE c.finalizada = 1 AND c.fechaBaja IS NULL
    GROUP BY c.id, c.fecha, c.ventas`);

  const porMes = new Map();
  const nuevo = () => ({ cajas: 0, difA: 0, a: 0, b: 0, amb: 0, ab: 0, c: 0, difB: 0, sumaAbsB: 0 });
  const posDeploy = { cajas: 0, difB: 0, difA_c: 0 };
  const tot = nuevo();
  let difBPositivas = 0, difBNegativas = 0;

  for (const c of cajas) {
    const declarado = Number(c.declarado), sinBaja = Number(c.sinBaja);
    const sumNc = Number(c.sumNc), sumAnul = Number(c.sumAnuladas);
    const difA = redondear2(declarado - sinBaja);
    const difB = redondear2(declarado - (sinBaja + sumNc));
    const mes = c.mes ?? 'sin fecha';
    if (!porMes.has(mes)) porMes.set(mes, nuevo());
    const m = porMes.get(mes);
    const post = c.dia && c.dia > FECHA_DEPLOY_3_2_0;

    for (const acc of [m, tot]) acc.cajas++;
    if (post) posDeploy.cajas++;

    let categoriaA = null;
    if (Math.abs(difA) > TOLERANCIA) {
      const a = sumNc > 0 && Math.abs(difA - sumNc) <= TOLERANCIA;
      const b = sumAnul > 0 && Math.abs(difA - sumAnul) <= TOLERANCIA;
      const ab = sumNc > 0 && sumAnul > 0 && Math.abs(difA - (sumNc + sumAnul)) <= TOLERANCIA;
      categoriaA = a && b ? 'amb' : a ? 'a' : b ? 'b' : ab ? 'ab' : 'c';
      for (const acc of [m, tot]) { acc.difA++; acc[categoriaA]++; }
      if (post && categoriaA === 'c') posDeploy.difA_c++;
    }
    if (Math.abs(difB) > TOLERANCIA) {
      for (const acc of [m, tot]) { acc.difB++; acc.sumaAbsB += Math.abs(difB); }
      if (difB > 0) difBPositivas++; else difBNegativas++;
      if (post) posDeploy.difB++;
    }
  }

  R.linea(`Cajas finalizadas analizadas (sin baja): ${tot.cajas}`);
  R.linea(`- con difA ≠ 0: ${tot.difA} → explicadas por (a) suma de NC totales: ${tot.a} · (b) suma de anuladas: ${tot.b} · (a) y (b) dan el mismo monto, ambigua: ${tot.amb} · (a)+(b) juntas: ${tot.ab} · (c) ninguna: ${tot.c}`);
  R.linea(`- con difB ≠ 0: ${tot.difB} (positivas: ${difBPositivas}, negativas: ${difBNegativas}) · suma absoluta: ${redondear2(tot.sumaAbsB).toFixed(2)}`);
  R.linea('');
  R.tabla(['Mes', 'Cajas', 'difA ≠ 0', '(a) NC', '(b) anuladas', '(a)+(b) / ambigua', '(c) ninguna', 'difB ≠ 0', 'Suma abs. difB'],
    [...porMes.entries()].sort((x, y) => String(x[0]).localeCompare(String(y[0])))
      .map(([mes, m]) => [mes, m.cajas, m.difA, m.a, m.b, m.ab + m.amb, m.c, m.difB, m.sumaAbsB.toFixed(2)]));
  R.linea(`Después del ${FECHA_DEPLOY_3_2_0} (deploy 3.2-0, cajas con fecha posterior): ${posDeploy.cajas} caja(s) finalizada(s) · con difB ≠ 0: ${posDeploy.difB} · con difA sin explicación (c): ${posDeploy.difA_c}`);
  R.linea('');

  if (tot.c > 0) {
    R.hallazgo(`${tot.c} caja(s) con diferencia en \`cajas.ventas\` que ni las NC totales ni las anuladas explican exactamente (tolerancia ${TOLERANCIA}).`);
  }
  if (posDeploy.difB > 0) {
    R.hallazgo(`${posDeploy.difB} caja(s) con fecha posterior al ${FECHA_DEPLOY_3_2_0} tienen \`cajas.ventas\` inconsistente incluso con la regla nueva: el problema sigue después del fix 3.2-0.`, { critico: true });
  }
}

async function checkC12_4(conn, ctx) {
  const R = ctx.reporte;
  R.linea('### C12.4 Proveedores y fondo');
  R.linea('');
  if (!tablaYColumnaExisten(ctx.columnas, 'proveedor_cuenta_movimientos', 'idCaja')) {
    R.linea('`proveedor_cuenta_movimientos` no existe en esta base (módulo de proveedores no instalado) — sección omitida.');
    R.linea('');
    return;
  }

  if (tablaYColumnaExisten(ctx.columnas, 'cajas', 'fondoProveedores')) {
    const [fondo] = await filas(conn, `
      SELECT COUNT(*) AS conFondo,
             SUM(CASE WHEN c.fondoProveedores = 0 THEN 1 ELSE 0 END) AS enCero,
             SUM(CASE WHEN COALESCE(p.pagado, 0) > c.fondoProveedores THEN 1 ELSE 0 END) AS superan
      FROM cajas c
      LEFT JOIN (SELECT idCaja, SUM(haber) AS pagado FROM proveedor_cuenta_movimientos
                 WHERE tipo = 'pago' AND anulado = 0 AND idCaja IS NOT NULL GROUP BY idCaja) p ON p.idCaja = c.id
      WHERE c.fondoProveedores IS NOT NULL`);
    R.linea(`Cajas con \`fondoProveedores\` no nulo: ${fondo.conFondo || 0} (de las cuales en 0: ${fondo.enCero || 0}) · con pagos que superan el fondo: ${fondo.superan || 0}`);
  } else {
    R.linea('`cajas.fondoProveedores` no existe en esta base.');
  }
  R.linea('');

  const pagos = await filas(conn, `
    SELECT YEAR(fecha) AS anio,
           SUM(CASE WHEN idCaja IS NOT NULL THEN 1 ELSE 0 END) AS conCaja,
           SUM(CASE WHEN idCaja IS NULL THEN 1 ELSE 0 END) AS sinCaja,
           COALESCE(SUM(CASE WHEN idCaja IS NOT NULL THEN haber END), 0) AS montoConCaja,
           COALESCE(SUM(CASE WHEN idCaja IS NULL THEN haber END), 0) AS montoSinCaja
    FROM proveedor_cuenta_movimientos
    WHERE tipo = 'pago' AND anulado = 0
    GROUP BY YEAR(fecha) ORDER BY anio`);
  R.linea('Pagos a proveedor (`tipo = \'pago\'`, no anulados) con y sin `idCaja`:');
  R.linea('');
  R.tabla(['Año', 'Con idCaja', 'Sin idCaja', 'Monto con idCaja', 'Monto sin idCaja'],
    pagos.map(p => [p.anio ?? 'sin fecha', p.conCaja || 0, p.sinCaja || 0, Number(p.montoConCaja).toFixed(2), Number(p.montoSinCaja).toFixed(2)]));

  if (!tablaYColumnaExisten(ctx.columnas, 'cajas_movimientos', 'idProveedorMovimiento')) {
    R.linea('`cajas_movimientos.idProveedorMovimiento` no existe en esta base — no se puede buscar pagos sin movimiento de caja.');
    R.linea('');
    return;
  }
  const huerfanos = await filas(conn, `
    SELECT pcm.id, YEAR(pcm.fecha) AS anio
    FROM proveedor_cuenta_movimientos pcm
    WHERE pcm.tipo = 'pago' AND pcm.anulado = 0 AND pcm.idCaja IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM cajas_movimientos cm WHERE cm.idProveedorMovimiento = pcm.id)
    ORDER BY pcm.id`);
  R.linea(`Pagos con \`idCaja\` y sin \`cajas_movimientos\` correspondiente (bug viejo de \`idCajaContexto\` string): ${huerfanos.length}`);
  if (huerfanos.length > 0) {
    const porAnio = new Map();
    for (const h of huerfanos) porAnio.set(h.anio ?? 'sin fecha', (porAnio.get(h.anio ?? 'sin fecha') || 0) + 1);
    R.linea('');
    R.tabla(['Año', 'Pagos sin movimiento de caja'], [...porAnio.entries()].map(([a, n]) => [a, n]));
    R.linea(`Muestra de ids (máx. 20): ${huerfanos.slice(0, 20).map(h => h.id).join(', ')}`);
    R.linea('');
    R.hallazgo(`${huerfanos.length} pago(s) a proveedor imputado(s) a una caja que nunca generó su SALIDA en \`cajas_movimientos\`: el arqueo de esa caja no los refleja.`);
  }
  R.linea('');
}

async function checkC12(conn, ctx) {
  const f = fragmentosCaja(ctx);
  const partes = [['C12.1', checkC12_1], ['C12.2', checkC12_2], ['C12.3', checkC12_3], ['C12.4', checkC12_4]];
  for (const [id, fn] of partes) {
    // Una query que falla se registra y se sigue con la próxima parte: que falte algo es un hallazgo, no un crash.
    try {
      await fn(conn, ctx, f);
    } catch (err) {
      ctx.reporte.error(`${id}: ${err.message}`);
      console.error(`  ${id} falló (se sigue con la próxima parte): ${err.message}`);
    }
    ctx.reporte.linea('');
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const CHECKS = [
  ['C1', 'Servidor y tablas', checkC1],
  ['C2', 'Deriva contra referencia', checkC2],
  ['C3', 'knex_migrations', checkC3],
  ['C4', 'Compatibilidad de tipos por relación', checkC4],
  ['C5', 'Integridad por relación', checkC5],
  ['C6', 'Registros especiales', checkC6],
  ['C7', 'Duplicados', checkC7],
  ['C8', 'Índices de architecture.md §12.2', checkC8],
  ['C9', 'Pre-conciliación de caja', checkC9],
  ['C10', 'Stock', checkC10],
  ['C11', 'Foreign keys existentes', checkC11],
  ['C12', 'Caja (3.4-0)', checkC12],
];

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  asegurarPrefijoDiag(args.db, '--db');
  if (args.ref) asegurarPrefijoDiag(args.ref, '--ref');

  const credenciales = leerCredencialesDb();
  const versionMysqlCliente = versionMysqlDelDump(args.dump);

  const conn = await mysql.createConnection({
    host: credenciales.host,
    user: credenciales.user,
    password: credenciales.password,
    database: args.db,
  });

  try {
    console.log(`Conectado a "${args.db}". Recolectando metadata de schema...`);
    const [tablas_, columnas, indices, foreignKeys] = await Promise.all([
      obtenerTablas(conn, args.db),
      obtenerColumnas(conn, args.db),
      obtenerIndices(conn, args.db),
      obtenerForeignKeys(conn, args.db),
    ]);

    let refTablas = null, refColumnas = null, refIndices = null, refForeignKeys = null;
    if (args.ref) {
      console.log(`Recolectando metadata de la referencia "${args.ref}"...`);
      [refTablas, refColumnas, refIndices, refForeignKeys] = await Promise.all([
        obtenerTablas(conn, args.ref),
        obtenerColumnas(conn, args.ref),
        obtenerIndices(conn, args.ref),
        obtenerForeignKeys(conn, args.ref),
      ]);
    }

    const reporte = crearReporte();
    const ctx = {
      reporte,
      tablas: tablas_, columnas, indices, foreignKeys,
      ref: args.ref, refTablas, refColumnas, refIndices, refForeignKeys,
      versionMysqlCliente,
    };

    for (const [id, titulo, fn] of CHECKS) {
      reporte.iniciarCheck(id, titulo);
      console.log(`Corriendo ${id} — ${titulo}...`);
      try {
        await fn(conn, ctx);
      } catch (err) {
        reporte.error(err.message);
        console.error(`  ${id} tiró un error inesperado (se sigue con el próximo check): ${err.message}`);
      }
    }

    const [{ 'VERSION()': versionMysqlLocal }] = await filas(conn, 'SELECT VERSION() AS `VERSION()`');
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const md = reporte.render({
      db: args.db,
      fecha: new Date().toISOString().slice(0, 10),
      versionMysqlLocal,
      versionMysqlCliente,
      ref: args.ref,
    });

    fs.mkdirSync(INFORMES_DIR, { recursive: true });
    const rutaInforme = path.join(INFORMES_DIR, `${args.db}_${fecha}.md`);
    fs.writeFileSync(rutaInforme, md, 'utf8');

    console.log(`\nInforme escrito en: ${rutaInforme}`);
  } finally {
    await conn.end();
  }
}

main().catch(err => {
  console.error('\nFalló diagnosticar.js:');
  console.error(err.stack || err.message);
  process.exit(1);
});
