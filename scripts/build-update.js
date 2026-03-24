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

// ZIP único (temporal)
const zipPath = path.resolve('update.zip');
zip.writeZip(zipPath);

console.log(`📦 ZIP generado: ${zipPath}`);