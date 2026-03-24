# 🚀 Backend Release Process (EasySales)

Este documento describe el flujo completo para generar y publicar una nueva versión del backend utilizando un sistema de releases manuales controlados.

---

# 🧠 🎯 Filosofía del flujo

El backend **NO se buildéa automáticamente en CI**.

En su lugar:

* El build se realiza localmente
* Se genera un `.zip` listo para deploy
* Se crea un release en GitHub
* El CI solo descarga ese archivo y lo sube al servidor

👉 Esto evita builds innecesarios y da control total sobre cuándo se publica una versión.

---

# 📦 🔧 Requisitos previos

Antes de usar este flujo:

* Tener instalado:

  * Node.js
  * Git
  * GitHub CLI (`gh`)

* Estar autenticado en GitHub:

```bash
gh auth login
```

---

# ⚙️ 🧩 Scripts involucrados

## 1. `setup.js`

Prepara el entorno del backend:

* crea carpetas necesarias
* copia archivos críticos
* ajusta config según entorno
* deja el build listo para producción

---

## 2. `build:update`

Genera el archivo final:

```text
/update.zip
```

Contenido:

* código compilado (`dist/src`)
* package.json

👉 Este archivo es el que se distribuye.

---

## 3. `release.js`

Script principal que automatiza todo el proceso.

---

# 🚀 🧪 Flujo completo de release

## ▶️ Paso 1 — Ejecutar release

```bash
npm run release
```

Opcional:

```bash
npm run release patch
npm run release minor
npm run release major
```

---

## ⚙️ Paso 2 — Qué hace internamente

### 1. Validaciones

* ✔ verifica que no haya cambios sin commitear
* ✔ verifica que todo esté pusheado

---

### 2. Versionado automático

* lee `package.json`
* incrementa versión (semver)
* guarda cambios

Ejemplo:

```text
2.4.0 → 2.4.1
```

---

### 3. Commit automático

```bash
git add package.json
git commit -m "release: vX.X.X"
git push
```

---

### 4. Build del backend

```bash
npm run build
node build-update.js
```

👉 genera:

```text
/update.zip
```

---

### 5. Tag de Git

```bash
git tag vX.X.X
git push origin vX.X.X
```

---

### 6. Crear release en GitHub

```bash
gh release create vX.X.X update.zip
```

👉 Se sube el archivo como asset del release.

---

# 🤖 ⚡ CI (GitHub Actions)

El CI funciona así:

## Trigger

```yaml
on:
  release:
    types: [published]
```

---

## Qué hace

1. descarga `update.zip` desde el release
2. lo envía a tu backend mediante `curl`

👉 NO buildéa nada

---

# 📁 Archivos importantes

```text
/scripts/release.js
/setup.js
/package.json
/update.zip (temporal)
```

---

# ⚠️ Buenas prácticas

## ✔ Ignorar el zip

En `.gitignore`:

```gitignore
update.zip
actualizaciones/
```

---

## ✔ Siempre generar el zip antes del release

Nunca reutilizar uno viejo.

---

## ✔ No modificar versiones manualmente

Siempre usar:

```bash
npm run release
```

---

## ✔ Verificar cambios antes de release

El script ya lo valida, pero es buena práctica:

```bash
git status
```

---

# 💥 Errores comunes

## ❌ "gh no reconocido"

👉 instalar GitHub CLI

---

## ❌ release con zip viejo

👉 no regeneraste `update.zip`

---

## ❌ CI falla al subir

👉 revisar:

* secrets
* endpoint backend
* formato de `curl`

---

# 🧠 Resumen mental

```text
1. npm run release
2. build + zip
3. tag + release
4. CI lo sube
```

---

# 🚀 Resultado final

✔ control total del deploy
✔ builds reproducibles
✔ CI liviano
✔ proceso claro y mantenible

---

# 🔥 Nivel del flujo

Este sistema implementa un modelo de:

```text
Release-driven deployment
```

👉 estándar en sistemas profesionales y SaaS.

---
