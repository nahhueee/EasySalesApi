const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const zip = new AdmZip();

// ⚠️ IMPORTANTE — lo que NO entra acá no llega nunca a los clientes.
// El ZIP contiene solo `src` y `package.json`. Quedan afuera, deliberadamente:
// `updater/`, `bootstrap.ts` y `scripts/`.
//
// Consecuencia: el updater instalado en cada comercio NO se autoactualiza. Cambiarlo
// requiere ir físicamente a cada instalación. Por eso todo lo que el updater consume es
// contrato congelado: `terminal.json` y la superficie de `src/conf/app.config` que
// importa (`adminUrl`, `idApp`).
//
// Antes de agregar `updater/` a este ZIP: no alcanza con incluirlo, porque el proceso
// que corre es el viejo y se estaría sobrescribiendo a sí mismo en pleno uso. Hace falta
// el swap en dos fases descrito en architecture.md §16.7.

// Código compilado
zip.addLocalFolder('dist/src', 'src');

// Package.json
zip.addLocalFile(pkgPath);

// ZIP único (temporal)
const zipPath = path.resolve('update.zip');
zip.writeZip(zipPath);

console.log(`📦 ZIP generado: ${zipPath}`);