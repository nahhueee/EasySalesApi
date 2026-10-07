// Migration: reconciliar el schema de TODAS las instalaciones existentes (Fase 3.1-A).
// Ver documentos/handoff_fase3_1a_reconciliar_schema.md.
//
// Lleva cada base de la flota al mismo schema objetivo, en 4 pasos:
//   1. Alinear tipos      — 14 columnas hija INT (con signo) pasan al tipo de la PK del padre.
//   2. Índices            — conjunto mínimo de architecture.md §12.2.
//   3. Restaurar FKs      — las que alguna migration ya declaró y el bootstrap hizo perder.
//   4. Deriva por generación — ampliar (nunca restringir): productos.fechaBaja, ventas.idCaja.
//
// REGLAS (no negociables):
//   R1. 100% introspectiva e idempotente: cada paso consulta information_schema y cambia solo si
//       hace falta; se puede correr N veces o retomar después de un corte (MySQL no revierte DDL).
//   R2. Ante datos inesperados SALTEA y AVISA; no falla. Fallar acá revierte el CÓDIGO de la
//       release en ese comercio por un dato puntual.
//
// ⚠ Consecuencia de R2: knex marca esta migration como aplicada aunque haya salteado pasos, y
// NO la vuelve a correr. Lo salteado queda así hasta que otra migration lo reintente. Por eso los
// helpers y las listas se exportan (module.exports.helpers / FKS_DECLARADAS / ...): la limpieza de
// huérfanos (Fase 3.5) puede reusarlos para completar lo que acá se salteó.
//
// ⚠ Los console.warn NO alcanzan: el updater corre `knex migrate:latest` con stdio:'pipe' y
// descarta la salida si termina bien. Cada aviso se agrega además a updater/actualizaciones.log
// (el log del updater, mismo formato). EASYSALES_AVISOS_LOG lo redirige (lo usa migrar.js).
//
// Prohibido acá: escribir datos de negocio (ninguna sentencia de escritura sobre tablas de negocio);
// fijar juego de caracteres o collation en cualquier DDL (las tablas e índices heredan el default
// de la base; si no, "Illegal mix of collations" en las bases latin1); FKs nuevas sobre relaciones legacy (solo se RESTAURAN las ya declaradas);
// sintaxis exclusiva de MySQL 8 (ALGORITHM=INSTANT, IF NOT EXISTS en CREATE INDEX: no existe).
//
// Todo SQL con nombres de tabla/columna sale de las listas fijas de este archivo, nunca de input.

const fs = require('fs');
const path = require('path');

const MODULO = 'reconciliar_schema_fase3';

// ---------------------------------------------------------------------------
// Listas fijas
// ---------------------------------------------------------------------------

// Paso 1 — [hija, columna, padre]. La hija adopta el tipo de padre.id.
// No se tocan cajas.id ni ventas_entrega.id (INT con signo en ambos lados: ya son compatibles) ni
// usuarios_movimientos.idUsuario (sin FK por diseño).
const TIPOS_A_ALINEAR = [
  ['ventas', 'idCliente', 'clientes'],
  ['ventas_detalle', 'idVenta', 'ventas'],            // parte de la PK compuesta (id, idVenta)
  ['ventas_detalle', 'idProducto', 'productos'],
  ['ventas_factura', 'idVenta', 'ventas'],            // es PK
  ['ventas_pago', 'idVenta', 'ventas'],               // es PK
  ['ventas_entrega', 'idCliente', 'clientes'],
  ['ventas_entrega_detalle', 'idVenta', 'ventas'],
  ['ventas_pagos_detalle', 'idVenta', 'ventas'],
  ['ventas_pagos_detalle', 'idTPago', 'tipos_pago'],
  ['cajas', 'idResponsable', 'usuarios'],
  ['productos', 'idCategoria', 'categorias'],
  ['usuarios', 'idCargo', 'cargos'],
  ['registros_detalle', 'idRegistro', 'registros'],
  ['proveedor_cuenta_movimientos', 'idTipoPago', 'tipos_pago'],
];

// Paso 2 — [tabla, columna]. Índice idx_<tabla>_<columna> solo si ninguna clave existente tiene la
// columna como PRIMERA columna. (ventas_pago.idVenta ya es PK; los de eventos/puestos van en 3.2.)
const INDICES = [
  ['ventas', 'idCaja'],
  ['ventas', 'idCliente'],
  ['ventas', 'fecha'],
  ['ventas_detalle', 'idVenta'],
  ['ventas_detalle', 'idProducto'],
  ['ventas_pagos_detalle', 'idVenta'],
  ['cajas', 'idResponsable'],
  ['cajas', 'fecha'],
  ['cajas_movimientos', 'idCaja'],
  ['productos', 'codigo'],
  ['productos', 'idCategoria'],
];

// Paso 3 — FKs que alguna migration de src/db/tasks declaró (verificadas leyendo cada archivo, con
// su ON DELETE final: las dos de cajas_movimientos pasaron a SET NULL en 20260724090000).
// Misma lista que scripts/diagnostico/relaciones.js -> conFk. onDelete null = RESTRICT/NO ACTION.
const FKS_DECLARADAS = [
  { tabla: 'ventas_pagos_detalle', columna: 'idVenta', padre: 'ventas', onDelete: null },                     // 20260319122913
  { tabla: 'presupuestos', columna: 'idCliente', padre: 'clientes', onDelete: null },                         // 20260605120000
  { tabla: 'presupuestos', columna: 'idVentaGenerada', padre: 'ventas', onDelete: null },
  { tabla: 'presupuestos_detalle', columna: 'idPresupuesto', padre: 'presupuestos', onDelete: null },
  { tabla: 'productos_precios', columna: 'idProducto', padre: 'productos', onDelete: null },                  // 20260611120000
  { tabla: 'productos_precios', columna: 'idLista', padre: 'listas_precio', onDelete: null },
  { tabla: 'producto_precio_historial', columna: 'idProducto', padre: 'productos', onDelete: null },          // 20260615120000
  { tabla: 'producto_precio_historial', columna: 'idLista', padre: 'listas_precio', onDelete: null },
  { tabla: 'cuenta_corriente_movimientos', columna: 'idCliente', padre: 'clientes', onDelete: null },         // 20260622092000
  { tabla: 'notas_credito', columna: 'idVenta', padre: 'ventas', onDelete: null },                           // 20260626120000
  { tabla: 'notas_credito_detalle', columna: 'idNotaCredito', padre: 'notas_credito', onDelete: null },
  { tabla: 'clientes', columna: 'idLista', padre: 'listas_precio', onDelete: null },                         // 20260711140000
  { tabla: 'ventas', columna: 'idLista', padre: 'listas_precio', onDelete: null },
  { tabla: 'ventas_entrega', columna: 'idCaja', padre: 'cajas', onDelete: null },                            // 20260723120000
  { tabla: 'ventas_pagos_detalle', columna: 'idCaja', padre: 'cajas', onDelete: null },
  { tabla: 'cajas_movimientos', columna: 'idEntrega', padre: 'ventas_entrega', onDelete: 'SET NULL' },        // 20260723 + 20260724090000
  { tabla: 'cajas_movimientos', columna: 'idVentaPagoDetalle', padre: 'ventas_pagos_detalle', onDelete: 'SET NULL' },
  { tabla: 'proveedor_cuenta_movimientos', columna: 'idProveedor', padre: 'proveedores', onDelete: null },    // 20260808100000
  { tabla: 'cajas_movimientos', columna: 'idProveedorMovimiento', padre: 'proveedor_cuenta_movimientos', onDelete: null }, // 20260808130000
  { tabla: 'productos', columna: 'idProveedor', padre: 'proveedores', onDelete: 'SET NULL' },                 // 20260817120000
  { tabla: 'cajas_movimientos', columna: 'idMovimientoCompensado', padre: 'cajas_movimientos', onDelete: 'SET NULL' }, // 20260903120000
  { tabla: 'productos_proveedores', columna: 'idProducto', padre: 'productos', onDelete: null },              // 20260908120000
  { tabla: 'productos_proveedores', columna: 'idProveedor', padre: 'proveedores', onDelete: null },
  { tabla: 'importaciones_costos', columna: 'idProveedor', padre: 'proveedores', onDelete: null },            // 20260915120000
  { tabla: 'importaciones_costos_detalle', columna: 'idImportacion', padre: 'importaciones_costos', onDelete: null },
  { tabla: 'importaciones_costos_detalle', columna: 'idProducto', padre: 'productos', onDelete: null },
];

// Índices que el paso 2 garantiza pero que YA crea otra migration con exactamente este nombre
// (20260622091000_ventas_total.js crea idx_ventas_detalle_idVenta). Como el nombre coincide, el `down`
// no puede distinguir "lo creé yo" de "ya estaba": ante la duda no se borra (borrarlo sería quitarle
// a la base un índice que su migration original sigue esperando).
const INDICES_DE_OTRA_MIGRATION = new Set(['ventas_detalle.idVenta']);

const nombreIndice = (tabla, columna) => `idx_${tabla}_${columna}`;
const nombreFk = (tabla, columna) => `fk_${tabla}_${columna}`;

// ---------------------------------------------------------------------------
// Avisos (consola + log del updater)
// ---------------------------------------------------------------------------

function rutaLog() {
  return process.env.EASYSALES_AVISOS_LOG ||
    path.resolve(__dirname, '..', '..', '..', 'updater', 'actualizaciones.log');
}

function marcaDeTiempo() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${String(d.getFullYear()).slice(2)} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Mismo formato que LogggerActualizacion (winston) para que se lea junto al resto del log.
// Escribir el log nunca puede hacer fallar la migration.
function escribirLog(nivel, mensaje) {
  try {
    fs.appendFileSync(rutaLog(), `${marcaDeTiempo()} [${nivel}] | fase=migracion | modulo=${MODULO} | ${mensaje}\n`);
  } catch (_) { /* best-effort */ }
}

let cantidadAvisos = 0;

function avisar(mensaje) {
  cantidadAvisos++;
  console.warn(`[${MODULO}] ${mensaje}`);
  escribirLog('WARN', mensaje);
}

function informar(mensaje) {
  console.log(`[${MODULO}] ${mensaje}`);
  escribirLog('INFO', mensaje);
}

// Hook SOLO para la prueba V3 (migrar.js --cortar-despues-del-paso N): simula un corte a la mitad.
// Sin la variable de entorno no hace nada.
function cortePrueba(paso) {
  if (process.env.EASYSALES_TEST_CORTE_PASO === String(paso)) {
    throw new Error(`[${MODULO}] corte de prueba provocado después del paso ${paso} (EASYSALES_TEST_CORTE_PASO)`);
  }
}

// ---------------------------------------------------------------------------
// Introspección
// ---------------------------------------------------------------------------

// MySQL < 8.0.19 reporta el ancho de display de los enteros ("int(11) unsigned"); después no.
// Es el mismo tipo, no un desajuste.
function normalizarTipo(tipo) {
  return String(tipo).toLowerCase()
    .replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1')
    .replace(/\s+/g, ' ').trim();
}

// Único tipo que se interpola en un MODIFY: entero (con/sin UNSIGNED) o datetime.
const TIPO_SEGURO = /^((tinyint|smallint|mediumint|int|bigint)(\(\d+\))?( unsigned)?|datetime)$/i;

async function contar(knex, sql) {
  const [rows] = await knex.raw(sql);
  return Number(rows[0].n);
}

async function tablaExiste(knex, tabla) {
  const filas = await knex('information_schema.TABLES')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', tabla)
    .andWhere('TABLE_TYPE', 'BASE TABLE')
    .select('TABLE_NAME');
  return filas.length > 0;
}

async function obtenerColumna(knex, tabla, columna) {
  const [col] = await knex('information_schema.COLUMNS')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', tabla)
    .andWhere('COLUMN_NAME', columna)
    .select(
      'COLUMN_TYPE as tipo',
      'DATA_TYPE as tipoBase',
      'IS_NULLABLE as esNullable',
      'COLUMN_DEFAULT as valorDefault',
      'EXTRA as extra',
      'COLUMN_COMMENT as comentario'
    );
  return col || null;
}

// FKs en las que (tabla, columna) es la columna HIJA.
async function fksComoHija(knex, tabla, columna) {
  return knex('information_schema.KEY_COLUMN_USAGE as kcu')
    .join('information_schema.REFERENTIAL_CONSTRAINTS as rc', function () {
      this.on('rc.CONSTRAINT_NAME', '=', 'kcu.CONSTRAINT_NAME')
        .andOn('rc.CONSTRAINT_SCHEMA', '=', 'kcu.CONSTRAINT_SCHEMA')
        .andOn('rc.TABLE_NAME', '=', 'kcu.TABLE_NAME');
    })
    .where('kcu.TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('kcu.TABLE_NAME', tabla)
    .andWhere('kcu.COLUMN_NAME', columna)
    .whereNotNull('kcu.REFERENCED_TABLE_NAME')
    .select('kcu.CONSTRAINT_NAME as nombre', 'rc.DELETE_RULE as reglaBorrado');
}

// FKs de otras tablas que REFERENCIAN (tabla, columna) como padre.
async function fksComoPadre(knex, tabla, columna) {
  return knex('information_schema.KEY_COLUMN_USAGE as kcu')
    .where('kcu.TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('kcu.REFERENCED_TABLE_NAME', tabla)
    .andWhere('kcu.REFERENCED_COLUMN_NAME', columna)
    .select('kcu.CONSTRAINT_NAME as nombre', 'kcu.TABLE_NAME as tabla');
}

async function indiceConNombre(knex, tabla, nombre) {
  const filas = await knex('information_schema.STATISTICS')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', tabla)
    .andWhere('INDEX_NAME', nombre)
    .select('INDEX_NAME');
  return filas.length > 0;
}

// ¿Hay una clave (no FULLTEXT/SPATIAL) con esta columna como PRIMERA? Una PK compuesta (id, idVenta)
// NO cubre idVenta.
async function columnaEsPrimeraDeUnIndice(knex, tabla, columna) {
  const filas = await knex('information_schema.STATISTICS')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', tabla)
    .andWhere('COLUMN_NAME', columna)
    .andWhere('SEQ_IN_INDEX', 1)
    .whereNotIn('INDEX_TYPE', ['FULLTEXT', 'SPATIAL'])
    .select('INDEX_NAME');
  return filas.length > 0;
}

async function constraintExiste(knex, nombre) {
  const filas = await knex('information_schema.TABLE_CONSTRAINTS')
    .where('CONSTRAINT_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('CONSTRAINT_NAME', nombre)
    .select('CONSTRAINT_NAME');
  return filas.length > 0;
}

// ---------------------------------------------------------------------------
// DDL seguro
// ---------------------------------------------------------------------------

// Errores de MySQL DETERMINÍSTICOS por schema/datos (FK incompatible, no se puede cambiar una
// columna con FK, valor fuera de rango, huérfano que aparece justo ahora, nombre duplicado...).
// Se convierten en aviso + salteo (R2). Cualquier otro error (conexión caída, lock wait timeout,
// deadlock, error de sintaxis) se relanza: reintentarlo en la próxima actualización es lo correcto
// y NO debe quedar registrado como "migration aplicada".
const ERRNO_TOLERADOS = new Set([
  1005, // ER_CANT_CREATE_TABLE (incluye errno 150: FK mal formada)
  1061, // ER_DUP_KEYNAME
  1068, // ER_MULTIPLE_PRI_KEY
  1071, // ER_TOO_LONG_KEY
  1215, // ER_CANNOT_ADD_FOREIGN
  1264, // ER_WARN_DATA_OUT_OF_RANGE
  1265, // ER_WARN_DATA_TRUNCATED
  1292, // ER_TRUNCATED_WRONG_VALUE
  1451, // ER_ROW_IS_REFERENCED_2
  1452, // ER_NO_REFERENCED_ROW_2
  1821, // ER_FK_NO_INDEX_CHILD
  1822, // ER_FK_NO_INDEX_PARENT
  1824, // ER_FK_CANNOT_OPEN_PARENT (padre inexistente o no InnoDB, p. ej. MyISAM)
  1825, // ER_FK_INCORRECT_OPTION
  1826, // ER_FK_DUP_NAME
  1830, // ER_FK_COLUMN_NOT_NULL
  1832, // ER_FK_COLUMN_CANNOT_CHANGE
  1833, // ER_FK_COLUMN_CANNOT_CHANGE_CHILD
  3734, // ER_FK_NO_COLUMN_PARENT (falta la columna en la tabla referenciada)
  3780, // ER_FK_INCOMPATIBLE_COLUMNS
]);

async function ddlSeguro(contexto, fn) {
  try {
    await fn();
    return true;
  } catch (err) {
    if (ERRNO_TOLERADOS.has(err.errno)) {
      avisar(`${contexto}: MySQL rechazó el cambio (${err.code || err.errno}: ${err.sqlMessage || err.message}). Se saltea.`);
      return false;
    }
    throw err;
  }
}

// Reconstruye la definición completa de la columna para un MODIFY, PRESERVANDO NULL/NOT NULL,
// DEFAULT, AUTO_INCREMENT y COMMENT. Un MODIFY sin restatear NOT NULL y DEFAULT los resetea en
// silencio (el defecto de asegurarUnsigned() de 20260724090000, que fuerza NULL). Devuelve null si
// no se puede reconstruir de forma segura (default no numérico/expresión, columna generada, tipo
// raro): el llamador saltea con aviso.
//   `nullable`: undefined = conservar; true/false = forzar.
function definicionDeColumna(col, tipo, { nullable } = {}) {
  if (!TIPO_SEGURO.test(tipo)) return null;
  const extra = String(col.extra || '');
  if (/generated/i.test(extra)) return null; // columnas generadas y defaults-expresión: no se tocan

  const esNullable = nullable !== undefined ? nullable : col.esNullable === 'YES';

  let defecto = '';
  if (col.valorDefault === null || col.valorDefault === undefined) {
    // MySQL 8: COLUMN_DEFAULT es NULL tanto para "DEFAULT NULL" como para "sin default".
    // Nullable -> DEFAULT NULL explícito; NOT NULL -> sin default.
    defecto = esNullable ? ' DEFAULT NULL' : '';
  } else if (/^-?\d+$/.test(String(col.valorDefault))) {
    if (/unsigned/i.test(tipo) && String(col.valorDefault).startsWith('-')) return null;
    defecto = ` DEFAULT ${col.valorDefault}`;
  } else {
    return null;
  }

  const autoInc = /auto_increment/i.test(extra) ? ' AUTO_INCREMENT' : '';
  const comentario = col.comentario ? ' COMMENT ?' : '';
  return {
    sql: `${tipo} ${esNullable ? 'NULL' : 'NOT NULL'}${defecto}${autoInc}${comentario}`,
    bindings: col.comentario ? [col.comentario] : [],
  };
}

async function modificarColumna(knex, tabla, columna, definicion) {
  await knex.raw(`ALTER TABLE \`${tabla}\` MODIFY \`${columna}\` ${definicion.sql}`, definicion.bindings);
}

// ---------------------------------------------------------------------------
// Paso 1 — alinear tipos (la hija adopta el tipo del padre)
// ---------------------------------------------------------------------------

async function alinearTipoConPadre(knex, tabla, columna, tablaPadre) {
  const etiqueta = `${tabla}.${columna}`;

  const hija = await obtenerColumna(knex, tabla, columna);
  if (!hija) return 'omitido'; // tabla o columna inexistente: instalación vieja, sin aviso
  const padre = await obtenerColumna(knex, tablaPadre, 'id');
  if (!padre) return 'omitido';

  if (normalizarTipo(hija.tipo) === normalizarTipo(padre.tipo)) return 'ok';

  if (hija.tipoBase !== padre.tipoBase) {
    avisar(`${etiqueta} (${hija.tipo}) vs ${tablaPadre}.id (${padre.tipo}): distinto tipo base, no se alinea automáticamente. Se saltea.`);
    return 'saltado';
  }

  // MySQL no deja cambiar el tipo de una columna que participa en una FK (como hija o como padre).
  const comoHija = await fksComoHija(knex, tabla, columna);
  const comoPadre = await fksComoPadre(knex, tabla, columna);
  if (comoHija.length > 0 || comoPadre.length > 0) {
    avisar(`${etiqueta}: participa en una FK existente; no se puede cambiar su tipo sin tirarla. Se saltea.`);
    return 'saltado';
  }

  // No se puede pasar a UNSIGNED con valores negativos.
  if (/unsigned/i.test(padre.tipo)) {
    const negativos = await contar(knex, `SELECT COUNT(*) AS n FROM \`${tabla}\` WHERE \`${columna}\` < 0`);
    if (negativos > 0) {
      avisar(`${etiqueta}: ${negativos} fila(s) con valor negativo; no entran en ${padre.tipo}. Se saltea.`);
      return 'saltado';
    }
  }

  const definicion = definicionDeColumna(hija, padre.tipo);
  if (!definicion) {
    avisar(`${etiqueta}: no se pudo reconstruir la definición de forma segura (default/extra no soportado: default=${hija.valorDefault}, extra=${hija.extra}). Se saltea.`);
    return 'saltado';
  }

  const ok = await ddlSeguro(`alinear tipo de ${etiqueta}`, () => modificarColumna(knex, tabla, columna, definicion));
  return ok ? 'aplicado' : 'saltado';
}

// ---------------------------------------------------------------------------
// Paso 2 — índices
// ---------------------------------------------------------------------------

async function asegurarIndice(knex, tabla, columna) {
  const etiqueta = `${tabla}.${columna}`;

  if (!(await tablaExiste(knex, tabla))) return 'omitido';
  if (!(await obtenerColumna(knex, tabla, columna))) return 'omitido';

  if (await columnaEsPrimeraDeUnIndice(knex, tabla, columna)) return 'ok';

  const nombre = nombreIndice(tabla, columna);
  if (await indiceConNombre(knex, tabla, nombre)) {
    avisar(`${etiqueta}: ya existe un índice llamado ${nombre} pero no tiene esta columna primera. Se saltea.`);
    return 'saltado';
  }

  const ok = await ddlSeguro(`crear índice ${nombre}`, async () => {
    await knex.raw(`CREATE INDEX \`${nombre}\` ON \`${tabla}\` (\`${columna}\`)`);
  });
  return ok ? 'aplicado' : 'saltado';
}

// ---------------------------------------------------------------------------
// Paso 3 — restaurar FKs que las migrations declararon
// ---------------------------------------------------------------------------

async function asegurarFk(knex, tabla, columna, padre, onDelete) {
  const etiqueta = `${tabla}.${columna} -> ${padre}.id`;

  if (!(await tablaExiste(knex, tabla)) || !(await tablaExiste(knex, padre))) return 'omitido';
  const hija = await obtenerColumna(knex, tabla, columna);
  const colPadre = await obtenerColumna(knex, padre, 'id');
  if (!hija || !colPadre) return 'omitido';

  // Ya hay una FK sobre (tabla, columna): listo. No se comparan nombres (puede tener cualquiera).
  if ((await fksComoHija(knex, tabla, columna)).length > 0) return 'ok';

  if (normalizarTipo(hija.tipo) !== normalizarTipo(colPadre.tipo)) {
    avisar(`FK ${etiqueta}: tipos distintos (${hija.tipo} vs ${colPadre.tipo}). Se saltea.`);
    return 'saltado';
  }

  if (onDelete === 'SET NULL' && hija.esNullable !== 'YES') {
    avisar(`FK ${etiqueta}: ON DELETE SET NULL requiere columna nullable y es NOT NULL. Se saltea.`);
    return 'saltado';
  }

  // Huérfanos: cualquier valor no NULL sin padre. El 0 cuenta como huérfano (una FK real lo rechaza).
  const huerfanos = await contar(knex,
    `SELECT COUNT(*) AS n FROM \`${tabla}\` h
     WHERE h.\`${columna}\` IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM \`${padre}\` p WHERE p.\`id\` = h.\`${columna}\`)`);
  if (huerfanos > 0) {
    avisar(`FK ${etiqueta}: ${huerfanos} fila(s) huérfana(s). Se saltea (se resuelve en la limpieza de huérfanos).`);
    return 'saltado';
  }

  const nombre = nombreFk(tabla, columna);
  if (await constraintExiste(knex, nombre)) {
    avisar(`FK ${etiqueta}: ya existe una constraint llamada ${nombre} en otra columna. Se saltea.`);
    return 'saltado';
  }

  const clausulaDelete = onDelete ? ` ON DELETE ${onDelete}` : '';
  const ok = await ddlSeguro(`crear FK ${nombre}`, async () => {
    await knex.raw(
      `ALTER TABLE \`${tabla}\` ADD CONSTRAINT \`${nombre}\` FOREIGN KEY (\`${columna}\`) REFERENCES \`${padre}\` (\`id\`)${clausulaDelete}`
    );
  });
  return ok ? 'aplicado' : 'saltado';
}

// ---------------------------------------------------------------------------
// Paso 4 — deriva por generación (ampliar, nunca restringir)
// ---------------------------------------------------------------------------

// productos.fechaBaja: DATE -> DATETIME NULL. Los valores existentes quedan con hora 00:00:00.
async function ampliarFechaBajaProductos(knex) {
  const col = await obtenerColumna(knex, 'productos', 'fechaBaja');
  if (!col || col.tipoBase !== 'date') return col ? 'ok' : 'omitido';

  const definicion = definicionDeColumna(col, 'datetime', { nullable: true });
  if (!definicion) {
    avisar(`productos.fechaBaja: no se pudo reconstruir la definición de forma segura (default=${col.valorDefault}). Se saltea.`);
    return 'saltado';
  }
  const ok = await ddlSeguro('ampliar productos.fechaBaja a DATETIME', () => modificarColumna(knex, 'productos', 'fechaBaja', definicion));
  return ok ? 'aplicado' : 'saltado';
}

// ventas.idCaja: NOT NULL -> nullable (conserva tipo y default).
async function hacerNullableIdCajaVentas(knex) {
  const col = await obtenerColumna(knex, 'ventas', 'idCaja');
  if (!col || col.esNullable === 'YES') return col ? 'ok' : 'omitido';

  const definicion = definicionDeColumna(col, col.tipo, { nullable: true });
  if (!definicion) {
    avisar(`ventas.idCaja: no se pudo reconstruir la definición de forma segura (tipo=${col.tipo}, default=${col.valorDefault}). Se saltea.`);
    return 'saltado';
  }
  const ok = await ddlSeguro('hacer nullable ventas.idCaja', () => modificarColumna(knex, 'ventas', 'idCaja', definicion));
  return ok ? 'aplicado' : 'saltado';
}

// ---------------------------------------------------------------------------
// up / down
// ---------------------------------------------------------------------------

function contarResultados(resultados) {
  const cuenta = { aplicado: 0, ok: 0, saltado: 0, omitido: 0 };
  for (const r of resultados) cuenta[r]++;
  return cuenta;
}

exports.up = async function (knex) {
  cantidadAvisos = 0;
  informar('inicio');

  const paso1 = [];
  for (const [tabla, columna, padre] of TIPOS_A_ALINEAR) {
    paso1.push(await alinearTipoConPadre(knex, tabla, columna, padre));
  }
  cortePrueba(1);

  const paso2 = [];
  for (const [tabla, columna] of INDICES) {
    paso2.push(await asegurarIndice(knex, tabla, columna));
  }
  cortePrueba(2);

  const paso3 = [];
  for (const fk of FKS_DECLARADAS) {
    paso3.push(await asegurarFk(knex, fk.tabla, fk.columna, fk.padre, fk.onDelete));
  }
  cortePrueba(3);

  const paso4 = [
    await ampliarFechaBajaProductos(knex),
    await hacerNullableIdCajaVentas(knex),
  ];
  cortePrueba(4);

  const fmt = r => { const c = contarResultados(r); return `${c.aplicado} aplicados, ${c.ok} ya estaban, ${c.saltado} salteados, ${c.omitido} omitidos`; };
  informar(
    `fin — tipos: ${fmt(paso1)} | índices: ${fmt(paso2)} | FKs: ${fmt(paso3)} | deriva: ${fmt(paso4)} | avisos: ${cantidadAvisos}`
  );
};

exports.down = async function (knex) {
  // Solo se borran los índices y FKs que ESTE archivo crea, por nombre (fk_* / idx_* de sus listas),
  // y solo si existen. Las FKs/índices que ya existían (nombres de knex u otros) no se tocan.
  for (const fk of FKS_DECLARADAS) {
    const nombre = nombreFk(fk.tabla, fk.columna);
    const filas = await knex('information_schema.TABLE_CONSTRAINTS')
      .where('CONSTRAINT_SCHEMA', knex.raw('DATABASE()'))
      .andWhere('TABLE_NAME', fk.tabla)
      .andWhere('CONSTRAINT_NAME', nombre)
      .andWhere('CONSTRAINT_TYPE', 'FOREIGN KEY')
      .select('CONSTRAINT_NAME');
    if (filas.length > 0) {
      await knex.raw(`ALTER TABLE \`${fk.tabla}\` DROP FOREIGN KEY \`${nombre}\``);
    }
    // Si la columna no tenía índice, MySQL creó uno con el nombre de la constraint: es nuestro.
    if (await indiceConNombre(knex, fk.tabla, nombre)) {
      await knex.raw(`ALTER TABLE \`${fk.tabla}\` DROP INDEX \`${nombre}\``);
    }
  }

  for (const [tabla, columna] of INDICES) {
    if (INDICES_DE_OTRA_MIGRATION.has(`${tabla}.${columna}`)) continue;
    const nombre = nombreIndice(tabla, columna);
    if (await indiceConNombre(knex, tabla, nombre)) {
      await knex.raw(`ALTER TABLE \`${tabla}\` DROP INDEX \`${nombre}\``);
    }
  }

  // NO se revierte:
  //  - el tipo UNSIGNED de las 14 columnas hija (paso 1);
  //  - la ampliación de productos.fechaBaja a DATETIME ni ventas.idCaja a nullable (paso 4).
  // Volver a INT con signo o a DATE no aporta nada (el schema "viejo" era el defectuoso) y puede
  // perder datos (la hora de fechaBaja). Ver architecture.md §13.4.
};

// Exportado para que otras migrations (p. ej. la limpieza de huérfanos de 3.5) reintenten lo que
// acá se salteó. Knex solo exige up/down; el resto de los exports se ignora.
exports.TIPOS_A_ALINEAR = TIPOS_A_ALINEAR;
exports.INDICES = INDICES;
exports.FKS_DECLARADAS = FKS_DECLARADAS;
exports.helpers = {
  alinearTipoConPadre,
  asegurarIndice,
  asegurarFk,
  ampliarFechaBajaProductos,
  hacerNullableIdCajaVentas,
  definicionDeColumna,
  normalizarTipo,
};
