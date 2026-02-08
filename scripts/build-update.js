const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const pkgPath = path.resolve(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

const zip = new AdmZip();

// Código compilado
zip.addLocalFolder('dist/src', 'src');

// Package.json
zip.addLocalFile(pkgPath);

const outputDir = path.resolve('actualizaciones');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

//Guarda para historial
const zipPath = path.join(outputDir, `update-${pkg.version}.zip`);
zip.writeZip(zipPath);

// ZIP para CI (raíz del proyecto)
const ciZip = path.resolve('update.zip');
zip.writeZip(ciZip);

console.log(`📦 ZIP de actualización generado: ${zipPath}`);
