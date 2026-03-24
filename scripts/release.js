const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd, silent = false) {
  if (!silent) console.log(`\n>> ${cmd}`);

  const result = execSync(cmd, {
    stdio: silent ? "pipe" : "inherit"
  });

  return silent ? result.toString().trim() : "";
}

// =========================
// 0. Validaciones
// =========================

// git limpio
const status = run("git status --porcelain", true);
if (status) {
  console.error("❌ Tenés cambios sin commitear:");
  console.log(status);
  process.exit(1);
}

// todo pusheado
const local = run("git rev-parse @", true);
const remote = run("git rev-parse @{u}", true);

if (local !== remote) {
  console.error("❌ Tenés commits sin pushear");
  process.exit(1);
}

// =========================
// 1. Elegir tipo de versión
// =========================

const type = process.argv[2] || "patch"; // patch default

if (!["patch", "minor", "major"].includes(type)) {
  console.error("❌ Tipo inválido. Usar: patch | minor | major");
  process.exit(1);
}

// =========================
// 2. Bump version
// =========================

const pkgPath = path.resolve("package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

const [major, minor, patch] = pkg.version.split(".").map(Number);

let newVersion;

if (type === "patch") newVersion = `${major}.${minor}.${patch + 1}`;
if (type === "minor") newVersion = `${major}.${minor + 1}.0`;
if (type === "major") newVersion = `${major + 1}.0.0`;

pkg.version = newVersion;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

console.log(`📦 Version: ${pkg.version} → ${newVersion}`);

// =========================
// 3. Commit version
// =========================

run("git add package.json");
run(`git commit -m "release: v${newVersion}"`);
run("git push");

// =========================
// 4. Build + setup + zip
// =========================

run("npm run build");
run("node scripts/build-update.js");

// =========================
// 5. Buscar ZIP
// =========================

const zipPath = path.resolve("update.zip");

if (!fs.existsSync(zipPath)) {
  console.error("❌ No se encontró update.zip");
  process.exit(1);
}

// =========================
// 6. Tag
// =========================

const tag = `v${newVersion}`;

run(`git tag ${tag}`);
run(`git push origin ${tag}`);

// =========================
// 7. Release
// =========================

run(
  `gh release create ${tag} "${zipPath}" --title "${tag}" --notes "Backend release ${tag}"`
);

fs.unlinkSync(zipPath);

console.log("\n🚀 Release backend creada con éxito");