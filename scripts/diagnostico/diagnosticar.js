#!/usr/bin/env node
// scripts/diagnostico/diagnosticar.js
//
// Fase 3.0 — corre los checks C1-C10 (ver documentos/handoff_fase3_0_diagnostico_schema.md)
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
  for (const t of ctx.tablas) {
    filasTabla.push([
      t.TABLE_NAME,
      t.ENGINE || '?',
      t.TABLE_COLLATION || '?',
      t.TABLE_ROWS == null ? '?' : String(t.TABLE_ROWS),
      formatoBytes((t.DATA_LENGTH || 0) + (t.INDEX_LENGTH || 0)),
    ]);
    if (t.ENGINE && t.ENGINE.toUpperCase() === 'MYISAM') {
      ctx.reporte.hallazgo(`tabla \`${t.TABLE_NAME}\` usa MyISAM — MyISAM ignora las FKs sin avisar.`, { critico: true });
    }
  }
  ctx.reporte.tabla(['Tabla', 'Engine', 'Collation', 'Filas (aprox)', 'Tamaño'], filasTabla);
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
        filasTabla.push([`${rel.hija}.${rel.columna}`, `${rel.padre}.${rel.columnaPadre}`, '—', '—', '(no existe en esta base)']);
        continue;
      }

      const tipoHija = ctx.columnas.get(rel.hija).get(rel.columna).COLUMN_TYPE;
      const tipoPadre = ctx.columnas.get(rel.padre).get(rel.columnaPadre).COLUMN_TYPE;
      const coincide = tipoHija.toLowerCase() === tipoPadre.toLowerCase();
      const tieneIdx = tieneIndice(ctx.indices, rel.hija, rel.columna);
      const esAuditoria = clavesAuditoria.has(`${rel.hija}.${rel.columna}`);

      filasTabla.push([
        `${rel.hija}.${rel.columna}`,
        `${rel.padre}.${rel.columnaPadre}`,
        tipoHija,
        tipoPadre,
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
  ctx.reporte.tabla(['Relación', 'Referencia', 'Tipo hija', 'Tipo padre', 'Resultado'], filasTabla);

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

      ctx.reporte.linea(`- NULL: ${nulos} · = 0: ${ceros} · huérfanos: ${huerfanos}`);

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
