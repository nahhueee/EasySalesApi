const fs = require("fs-extra");
const path = require("path");

async function setup() {
  try {
    console.log("📂 Creando carpetas...");

    // Definir las carpetas necesarias
    const directories = [
      "out/src/upload",
      "out/src/db/seeds",
      "out/src/db/tasks"
    ];

    // Crear todas las carpetas
    for (const dir of directories) {
      await fs.ensureDir(dir);
    }

    console.log("✅ Carpetas creadas correctamente.");

    console.log("📂 Copiando archivos...");

    // Definir archivos individuales
    const filesToCopy = [
      "package.json",
      ".env",
      "config.json",
      "knexfile.js",
      "src/db/script.sql"
    ];

    // Copiar archivos individuales
    for (const file of filesToCopy) {
      await fs.copy(file, path.join("out", file));
    }

    // Copiar toda la carpeta tasks
    await fs.copy("src/db/tasks", "out/src/db/tasks");

    console.log("✅ Archivos copiados correctamente.");
  } catch (error) {
    console.error("❌ Error en la configuración:", error);
  }
}

setup();
