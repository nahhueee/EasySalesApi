const { execSync } = require("child_process");

function run(cmd) {
  console.log(`\n>> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

// Obtener tag desde argumento
const tag = process.argv[2];

if (!tag) {
  console.error("❌ Debes indicar el tag. Ej: npm run delete-tag v2.4.3");
  process.exit(1);
}

// Borrar release
try {
  run(`gh release delete ${tag} -y`);
} catch {
  console.log("⚠️ Release no existía");
}

try {
  // Borrar local
  run(`git tag -d ${tag}`);
} catch {
  console.log("⚠️ El tag local no existía");
}

try {
  // Borrar remoto
  run(`git push origin --delete ${tag}`);
} catch {
  console.log("⚠️ El tag remoto no existía");
}

console.log(`\n🧹 Tag ${tag} eliminado`);