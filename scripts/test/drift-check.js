#!/usr/bin/env node
// scripts/test/drift-check.js
//
// Chequeo de desvío de schema: compara la estructura de la base REAL (config.pc.json) contra la de TEST
// (config.test.json, construida solo con migrations). SOLO LECTURA sobre la base real:
// `mysqldump --no-data --skip-lock-tables` (sin datos, sin locks). No corrige nada: reporta.
//
// Uso:  npm run db:drift:test            (requiere mysqldump en el PATH)
//
// Normaliza lo que no es desvío real: AUTO_INCREMENT=N y el orden de las líneas dentro de cada tabla
// (columnas, keys y constraints se comparan como conjuntos; el orden de columnas se informa aparte).

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const leer = (f) => JSON.parse(fs.readFileSync(path.resolve(ROOT, f), 'utf8'));

function dump(db) {
  return execFileSync('mysqldump', [
    `--user=${db.user}`, `--host=${db.host}`,
    '--no-data', '--skip-lock-tables', '--skip-comments', '--skip-add-drop-table', '--skip-triggers', '--no-tablespaces',
    db.database,
  ], { env: { ...process.env, MYSQL_PWD: db.password }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .replace(/\r\n/g, '\n');
}

function parsear(sql) {
  const tablas = {};
  const re = /CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\) (.*?);/g;
  let m;
  while ((m = re.exec(sql))) {
    const lineas = m[2].split('\n').map((l) => l.trim().replace(/,$/, ''));
    tablas[m[1]] = {
      lineas: new Set(lineas),
      columnas: lineas.filter((l) => l.startsWith('`')).map((l) => l.split('`')[1]),
      opciones: m[3].replace(/AUTO_INCREMENT=\d+ ?/, '').trim(),
    };
  }
  return tablas;
}

function main() {
  const real = leer('config.pc.json').db;
  const test = leer('config.test.json').db;
  if (real.database === test.database) throw new Error('La base real y la de test son la misma. Abortado.');

  const R = parsear(dump(real));
  const T = parsear(dump(test));
  const salida = [];
  const log = (s = '') => salida.push(s);

  log(`# Desvío de schema: ${real.database} (real) vs ${test.database} (migrations)`);
  log(`Fecha: ${new Date().toISOString()}`);
  log(`Tablas: real=${Object.keys(R).length}, test=${Object.keys(T).length}`);

  const soloReal = Object.keys(R).filter((t) => !T[t]);
  const soloTest = Object.keys(T).filter((t) => !R[t]);
  if (soloReal.length) log(`\n## Tablas solo en la real\n${soloReal.map((t) => `- ${t}`).join('\n')}`);
  if (soloTest.length) log(`\n## Tablas solo en test\n${soloTest.map((t) => `- ${t}`).join('\n')}`);

  let conDiferencias = 0;
  for (const t of Object.keys(R).filter((x) => T[x]).sort()) {
    const r = R[t], s = T[t];
    const faltan = [...r.lineas].filter((l) => !s.lineas.has(l));
    const sobran = [...s.lineas].filter((l) => !r.lineas.has(l));
    const ordenDistinto = r.columnas.join() !== s.columnas.join()
      && [...r.columnas].sort().join() === [...s.columnas].sort().join();
    const opciones = r.opciones !== s.opciones;
    if (!faltan.length && !sobran.length && !ordenDistinto && !opciones) continue;
    conDiferencias++;
    log(`\n## ${t}`);
    for (const l of faltan) log(`- real : ${l}`);
    for (const l of sobran) log(`+ test : ${l}`);
    if (ordenDistinto) log(`~ orden de columnas distinto`);
    if (opciones) log(`~ opciones: real="${r.opciones}" | test="${s.opciones}"`);
  }
  log(`\nTablas comunes con diferencias: ${conDiferencias}`);

  const texto = salida.join('\n');
  console.log(texto);
  const dir = path.resolve(ROOT, 'scripts', 'test', 'informes');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.resolve(dir, `drift_${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(archivo, texto + '\n', 'utf8');
  console.log(`\nInforme: ${archivo}`);
}

main();
