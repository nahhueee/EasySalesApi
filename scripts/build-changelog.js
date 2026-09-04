const fs = require("fs");
const path = require("path");

const UNRELEASED_PATH = path.resolve("CHANGELOG.unreleased.md");
const HISTORY_PATH = path.resolve("CHANGELOG.md");
const RELEASE_DIR = path.resolve(".release");
const MAX_LEN = 400;

function normalizarTag(tag) {
  return tag
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // saca acentos: "corrección" -> "correccion"
}

function truncar(texto, max) {
  if (texto.length <= max) return { texto, truncado: false };
  return { texto: texto.slice(0, max - 1).trimEnd() + "…", truncado: true };
}

/**
 * Lee CHANGELOG.unreleased.md, separa líneas por tipo ([mejora] / [correccion]),
 * arma los textos para los campos `mejoras` y `correcciones` de adminserver,
 * escribe .release/mejoras.txt y .release/correcciones.txt, y devuelve
 * las líneas consumidas para que release.js las archive en CHANGELOG.md.
 */
function buildChangelog() {
  if (!fs.existsSync(UNRELEASED_PATH)) {
    console.warn(`⚠️  No existe ${UNRELEASED_PATH} — se sube release sin mejoras/correcciones.`);
    return { mejoras: "", correcciones: "", mejorasItems: [], correccionesItems: [] };
  }

  const raw = fs.readFileSync(UNRELEASED_PATH, "utf-8");
  const lineas = raw.split(/\r?\n/);

  const mejorasItems = [];
  const correccionesItems = [];

  const re = /^\s*-\s*\[([^\]]+)\]\s*(.+)$/;

  for (const linea of lineas) {
    const match = linea.match(re);
    if (!match) continue;

    const tagCrudo = normalizarTag(match[1].trim());
    const texto = match[2].trim();
    if (!texto) continue;

    if (tagCrudo === "mejora" || tagCrudo === "mejoras") {
      mejorasItems.push(texto);
    } else if (tagCrudo === "correccion" || tagCrudo === "correcciones") {
      correccionesItems.push(texto);
    } else {
      console.warn(`⚠️  Línea con tag desconocido "[${match[1]}]" ignorada: ${linea.trim()}`);
    }
  }

  if (mejorasItems.length === 0 && correccionesItems.length === 0) {
    console.warn(`⚠️  ${UNRELEASED_PATH} no tiene entradas — se sube release sin mejoras/correcciones. ¿Te olvidaste de anotarlas?`);
  }

  const mejorasJoin = mejorasItems.join(" | ");
  const correccionesJoin = correccionesItems.join(" | ");

  const mejoras = truncar(mejorasJoin, MAX_LEN);
  const correcciones = truncar(correccionesJoin, MAX_LEN);

  if (mejoras.truncado) {
    console.warn(`⚠️  Campo "mejoras" superó ${MAX_LEN} chars, se truncó. Texto completo queda igual en CHANGELOG.md.`);
  }
  if (correcciones.truncado) {
    console.warn(`⚠️  Campo "correcciones" superó ${MAX_LEN} chars, se truncó. Texto completo queda igual en CHANGELOG.md.`);
  }

  fs.mkdirSync(RELEASE_DIR, { recursive: true });
  fs.writeFileSync(path.join(RELEASE_DIR, "mejoras.txt"), mejoras.texto, "utf-8");
  fs.writeFileSync(path.join(RELEASE_DIR, "correcciones.txt"), correcciones.texto, "utf-8");

  return {
    mejoras: mejoras.texto,
    correcciones: correcciones.texto,
    mejorasItems,
    correccionesItems
  };
}

/**
 * Archiva las líneas consumidas en CHANGELOG.md (histórico, con versión y fecha)
 * y vacía CHANGELOG.unreleased.md dejando solo el header de instrucciones.
 */
function archivarChangelog(version, { mejorasItems, correccionesItems }) {
  const fecha = new Date().toISOString().slice(0, 10);

  let bloque = `## ${version} — ${fecha}\n\n`;

  if (mejorasItems.length) {
    bloque += `**Mejoras**\n`;
    for (const item of mejorasItems) bloque += `- ${item}\n`;
    bloque += `\n`;
  }

  if (correccionesItems.length) {
    bloque += `**Correcciones**\n`;
    for (const item of correccionesItems) bloque += `- ${item}\n`;
    bloque += `\n`;
  }

  if (!mejorasItems.length && !correccionesItems.length) {
    bloque += `_(sin entradas registradas para esta versión)_\n\n`;
  }

  const historicoPrevio = fs.existsSync(HISTORY_PATH)
    ? fs.readFileSync(HISTORY_PATH, "utf-8")
    : "# Changelog\n\n";

  fs.writeFileSync(HISTORY_PATH, historicoPrevio + bloque, "utf-8");

  const headerUnreleased =
    "<!--\n" +
    "CÓMO ANOTAR (vos, en el momento que cerrás algo — no al hacer el release):\n" +
    "* [mejora] descripción corta, en tu lenguaje técnico normal, sin pensar en redacción\n" +
    "* [correccion] descripción corta, en tu lenguaje técnico normal, sin pensar en redacción\n" +
    "\n" +
    "Ejemplo real: \"- [correccion] fix imask en vuelto de caja, se corrompía el number.toString()\"\n" +
    "Ejemplo real: \"- [mejora] permission check en pago/anulación a proveedor\"\n" +
    "\n" +
    "Solo esas dos etiquetas se procesan. Cualquier otra línea (como esta) se ignora.\n" +
    "\n" +
    "PARA CLAUDE, cuando te pida \"traducime el changelog pendiente\" antes de un release:\n" +
    "1. Leé las líneas [mejora]/[correccion] de este archivo tal cual están (jerga incluida).\n" +
    "2. Reescribilas en lenguaje de cliente: dueño de comercio sin conocimiento técnico,\n" +
    "   no developer. Nada de nombres de función, tablas, componentes, SQL, stack, ni\n" +
    "   términos internos (imask, endpoint, query, repo, commit, permission check, etc.).\n" +
    "3. Enfocate en el beneficio o el problema resuelto desde la perspectiva del comercio,\n" +
    "   no en el mecanismo técnico.\n" +
    "   Técnico: \"fix imask en vuelto de caja, se corrompía el number.toString()\"\n" +
    "   Cliente: \"Corregido un error que podía mostrar mal el vuelto en caja\"\n" +
    "   Técnico: \"permission check en pago/anulación a proveedor\"\n" +
    "   Cliente: \"Nuevo permiso para controlar quién puede pagar o anular pagos a proveedores\"\n" +
    "4. Agrupá todo lo [mejora] en un texto y todo lo [correccion] en otro, separados por\n" +
    "   \" | \" si hay varias — son los campos que van a `mejoras` y `correcciones` en\n" +
    "   adminserver, cada uno con tope de 400 caracteres.\n" +
    "5. Dame el resultado para pegar en el panel admin (el registro nace en estado\n" +
    "   'borrador', así que igual lo repaso ahí antes de promoverlo a canary/producción).\n" +
    "\n" +
    "No edites este archivo vos mismo salvo que te lo pida explícitamente — el que lo\n" +
    "vacía y archiva en CHANGELOG.md es el script de release (build-changelog.js).\n" +
    "-->\n";

  fs.writeFileSync(UNRELEASED_PATH, headerUnreleased, "utf-8");
}

module.exports = { buildChangelog, archivarChangelog, UNRELEASED_PATH, HISTORY_PATH, RELEASE_DIR };

// Permite correrlo standalone para debug: node scripts/build-changelog.js
if (require.main === module) {
  const resultado = buildChangelog();
  console.log("mejoras:", resultado.mejoras || "(vacío)");
  console.log("correcciones:", resultado.correcciones || "(vacío)");
}
