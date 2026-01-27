const fs = require("fs-extra");
const path = require("path");
require("dotenv").config();

// Raíz del proyecto (donde está package.json)
const ROOT = path.resolve(__dirname, "..");

// Carpeta final del build
const DIST_DIR = path.join(ROOT, "dist");

async function setup() {
  try {
    console.log("📦 Preparando build de servidor...");

    // Carpetas necesarias en runtime
    const directories = [
      "src/certs",
      "src/db/seeds",
      "src/db/tasks",
      "src/fonts",
      "src/temp",
      "src/tokens",
      "src/upload",
    ];

    for (const dir of directories) {
      await fs.ensureDir(path.join(DIST_DIR, dir));
    }

    console.log("✅ Carpetas creadas.");

    // Archivos base que el server necesita para correr
    const filesToCopy = [
      { from: "package.json", to: "package.json" },
      { from: "scripts/knexfile.js", to: "knexfile.js" },
      { from: "src/db/script.sql", to: "src/db/script.sql" },

      { from: "src/fonts/Roboto-Italic.ttf", to: "src/fonts/Roboto-Italic.ttf" },
      { from: "src/fonts/Roboto-Medium.ttf", to: "src/fonts/Roboto-Medium.ttf" },
      { from: "src/fonts/Roboto-Regular.ttf", to: "src/fonts/Roboto-Regular.ttf" },
      { from: "src/fonts/Roboto-MediumItalic.ttf", to: "src/fonts/Roboto-MediumItalic.ttf" },
    ];

    // Config según entorno
    const env = process.env.NODE_ENV || "pc";
    const configFile = `config.${env}.json`;
    filesToCopy.push({ from: configFile, to: configFile });

    for (const file of filesToCopy) {
      await fs.copy(
        path.join(ROOT, file.from),
        path.join(DIST_DIR, file.to)
      );
    }

    // Copiar tasks (único copy de carpetas)
    await fs.copy(
      path.join(ROOT, "src/db/tasks"),
      path.join(DIST_DIR, "src/db/tasks")
    );

    // Ajustar config para producción
    const configPath = path.join(DIST_DIR, configFile);
    const rawConfig = await fs.readFile(configPath, "utf-8");
    const config = JSON.parse(rawConfig);

    config.produccion = true;
    config.db.password = process.env.DB_PASSWORD || "1235";

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));

    console.log("🚀 Build preparado correctamente.");
  } catch (error) {
    console.error("❌ Error en setup:", error);
    process.exit(1);
  }
}

setup();
