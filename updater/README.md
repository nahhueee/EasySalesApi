# 🧩 Proceso de Actualización Automática

Este documento describe **de forma integral** cómo funciona el sistema de actualización automática de la aplicación.

El objetivo principal del updater es:

* Mantener la aplicación actualizada de forma **segura y controlada**
* Evitar downgrades accidentales
* Ser **tolerante a fallos**
* Permitir **diagnóstico rápido** en entornos de clientes

---

## 🧠 Principios de diseño

El sistema fue construido bajo los siguientes principios:

* **Separación de responsabilidades**: cada módulo hace una sola cosa
* **Idempotencia**: puede ejecutarse múltiples veces sin romper el estado
* **Fail-safe**: ante errores, la app sigue funcionando con la versión actual
* **Sin downgrades automáticos**
* **Logs claros y estructurados** para soporte técnico

---

## 🏗 Arquitectura general

El proceso completo ocurre durante el arranque de la aplicación y está compuesto por 4 módulos principales:

1. `bootstrap.ts`
2. `CheckearActualizacion.ts`
3. `DescargarActualizacion.ts`
4. `AplicarActualizacion.ts`

Cada módulo se ejecuta en orden y **solo si corresponde**.

---

## 🚀 1. Bootstrap (orquestador)

**Responsabilidad:**

* Coordinar todo el flujo de actualización
* Exponer un servidor de estado (`/status`)
* Garantizar que la aplicación arranque incluso si el updater falla

**Flujo:**

1. Inicia el servidor de estado
2. Intenta aplicar una actualización pendiente
3. Si no hay pendiente o falla:

   * Chequea si hay una nueva versión
   * Descarga la actualización si corresponde
4. Inicia la aplicación principal

**Regla clave:**

> El bootstrap **nunca bloquea el arranque definitivo** de la app.

---

## 🔍 2. CheckearActualizacion

**Responsabilidad:**

* Consultar al servidor administrativo
* Comparar versión local vs remota
* Describir el estado actual de versiones

**NO hace:**

* No descarga
* No aplica
* No reinicia

### Comparación de versiones

Se utiliza comparación semántica `X.Y.Z`:

| Escenario      | Resultado               |
| -------------- | ----------------------- |
| Remota > Local | `desactualizado = true` |
| Remota = Local | No acción               |
| Remota < Local | ⚠ Downgrade ignorado    |

> ⚠ Nunca se permite bajar de versión automáticamente.

Ante errores (timeout, backend caído):

* Se asume que **no hay actualización**
* El sistema continúa normalmente

---

## 📥 3. DescargarActualizacion

**Responsabilidad:**

* Descargar el ZIP de la nueva versión
* Registrar que existe una actualización pendiente

**Características clave:**

* Descarga en modo **stream** (no consume memoria)
* Descarga **idempotente** (si el ZIP existe, no se baja de nuevo)
* Manejo de versiones pendientes antiguas

### Archivo `pendiente.json`

Este archivo indica que hay una actualización lista para aplicar.

Contiene:

* versión
* ruta al ZIP
* fecha de descarga
* reintentos
* último error

> ⚠ Descargar **no aplica** la actualización

---

## ♻ 4. AplicarActualizacion

**Responsabilidad:**

* Aplicar una actualización descargada
* Proteger el sistema ante fallos

### Flujo interno

1. Leer `pendiente.json`
2. Verificar límites de reintentos
3. Crear backup de archivos críticos
4. Extraer ZIP
5. Instalar dependencias (`npm install`)
6. Ejecutar migraciones
7. Confirmar éxito y limpiar estado

---

### 🛡 Manejo de errores

Si ocurre cualquier error:

* Se incrementa el contador de reintentos
* Se registra el error en `pendiente.json`
* Se ejecuta **rollback automático** usando el backup
* El sistema continúa con la versión anterior

Si los reintentos ≥ 3:

* La actualización se marca como **bloqueada**
* No se vuelve a intentar automáticamente

---

## 📦 Backups

Antes de aplicar una actualización se respaldan:

* `src/`
* `package.json`
* `package-lock.json`

Esto permite volver al último estado funcional ante cualquier falla.

---

## 🩺 Logs y diagnóstico

Todo el sistema utiliza **logging estructurado (Winston)** con:

* `fase`
* `modulo`
* mensajes claros y accionables

Esto permite:

* Detectar en qué paso falló una actualización
* Diagnosticar errores en máquinas de clientes
* Reconstruir el historial del updater

---

## ✅ Garantías del sistema

✔ La app **siempre intenta arrancar**
✔ Nunca se baja de versión automáticamente
✔ Las actualizaciones son seguras y reversibles
✔ El sistema soporta reinicios inesperados
✔ Los errores quedan registrados

---

## 🧠 Resumen mental rápido

> **Checkear → Descargar → Marcar pendiente → Reiniciar → Aplicar → Reiniciar → Listo**

Si algo falla en cualquier punto:

> **Rollback + logs + versión anterior funcionando**

---

## 📌 Nota final

Este updater está diseñado para entornos reales:

* clientes finales
* conexiones inestables
* errores humanos
* reinicios inesperados

No busca ser "rápido", sino **confiable**.
