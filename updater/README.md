# Proceso de Actualización y Rollback

Describe cómo funciona el sistema de actualización automática, rollback y reporte de eventos a AdminServer.

El objetivo principal es:

* Mantener la aplicación actualizada de forma **segura y controlada**
* Soportar **rollback remoto** ordenado desde AdminServer
* Reportar el resultado de cada operación a la flota
* Ser tolerante a fallos: ante cualquier error, la app levanta con la versión actual

---

## Principios de diseño

* **Separación de responsabilidades**: cada módulo hace una sola cosa
* **Idempotencia**: puede ejecutarse múltiples veces sin romper el estado
* **Fail-safe**: ante errores, la app sigue funcionando con la versión actual
* **Sin downgrades automáticos** (excepto rollback explícito)
* **Logs claros y estructurados** para diagnóstico remoto

---

## Arquitectura general

El proceso ocurre durante el arranque y está compuesto por estos módulos:

```
bootstrap.ts
├── EjecutarRollback.ts      ← 0️⃣ prioridad máxima
├── AplicarActualizacion.ts  ← 1️⃣ si hay pendiente.json
├── CheckearActualizacion.ts ← 2️⃣ si hay conectividad
├── DescargarActualizacion.ts← 3️⃣ si hay versión nueva
└── src/index.ts             ← 4️⃣ arranque normal
```

Cada módulo se ejecuta solo si corresponde. Un fallo en cualquier paso no bloquea el arranque.

---

## 0. EjecutarRollback

**Se activa cuando:** existe `updater/pendiente-rollback.json`

**Origen del archivo:** `heartbeatService.ts` lo escribe cuando AdminServer responde `{ rollback: true }` al heartbeat. También se crea automáticamente si `iniciarApp()` falla y hay un backup disponible.

**Qué hace:**
1. Verifica que `updater/backup/src` exista
2. Restaura `src/` y `package.json` desde el backup
3. Elimina `pendiente-rollback.json`
4. Retorna `true` → bootstrap reinicia el proceso

**Si falla:** elimina el pendiente (para no quedar en loop), continúa con arranque normal.

---

## 1. AplicarActualizacion

**Se activa cuando:** existe `updater/pendiente.json`

**Flujo interno:**
1. Leer y validar `pendiente.json`
2. Verificar límite de reintentos (máx. 3)
3. Crear backup en `updater/backup/` (`src/`, `package.json`, `package-lock.json`)
4. Extraer ZIP sobre el directorio raíz
5. `npm install` (si `requiereNpmInstall !== false`)
6. Ejecutar migraciones con knex
7. Escribir `updater/evento-actualizacion.json` con resultado
8. Limpiar `pendiente.json` y el ZIP

**Si falla:**
* Rollback automático desde `updater/backup/`
* Escribe evento `aplicacion_fallida` con mensaje de error
* Incrementa `reintentos` en `pendiente.json`

**Protección anti-loop:** si `reintentos >= 3`, marca como `bloqueado` y no reintenta.

---

## 2. CheckearActualizacion

**Responsabilidad:** consultar AdminServer y comparar versión local vs remota.

No descarga, no aplica, no reinicia.

| Escenario      | Resultado               |
|----------------|-------------------------|
| Remota > Local | `desactualizado = true` |
| Remota = Local | Sin acción              |
| Remota < Local | Downgrade ignorado      |

Ante errores (timeout, AdminServer caído): asume que no hay actualización, continúa.

---

## 3. DescargarActualizacion

**Responsabilidad:** descargar el ZIP de la nueva versión y registrar `pendiente.json`.

* Descarga en modo stream (sin cargar en memoria)
* Si el ZIP ya existe, no vuelve a bajar
* Escribe `pendiente.json` al finalizar

**Flag `autoAplicar`:** si `tamanoBytes < 50 MB`, bootstrap aplica la actualización en el mismo arranque (1 reinicio en lugar de 2).

**Flag `requiereNpmInstall`:** si `false`, se omite `npm install` (~3-5 min ahorrados).

---

## 4. Arranque normal

Una vez superados los pasos anteriores, se lanza `src/index.ts`.

Si el arranque falla (`import` lanza excepción):
* Se loguea el error
* Si existe `updater/backup/src`, se escribe `pendiente-rollback.json` automáticamente
* El próximo arranque ejecutará el rollback antes de volver a intentar

---

## Eventos de actualización

Cada operación de update o rollback escribe `updater/evento-actualizacion.json`:

```json
{
  "tipo": "aplicacion_exitosa | aplicacion_fallida | rollback_exitoso | rollback_fallido",
  "version": "1.4.0",
  "error": null,
  "reintentos": 1,
  "fecha": "2026-05-13T..."
}
```

El `heartbeatService.ts` adjunta este archivo al próximo pulso hacia AdminServer, que lo persiste en `eventos_actualizacion`. El panel de flota muestra el último evento por terminal. El archivo se elimina una vez que AdminServer confirma la recepción.

---

## Archivos de estado

| Archivo                              | Propósito                                      |
|--------------------------------------|------------------------------------------------|
| `updater/pendiente.json`             | Actualización descargada esperando aplicación  |
| `updater/pendiente-rollback.json`    | Instrucción de rollback pendiente              |
| `updater/evento-actualizacion.json`  | Resultado del último update/rollback           |
| `updater/backup/`                    | Copia de seguridad pre-update                  |

---

## Garantías del sistema

* La app siempre intenta arrancar
* Nunca se baja de versión automáticamente (solo por rollback explícito)
* Las actualizaciones son reversibles
* Los errores quedan registrados y son visibles desde AdminServer
* AdminServer puede ordenar un rollback remotamente en cualquier momento

---

## Flujo mental rápido

**Update normal:**
> Checkear → Descargar → `pendiente.json` → Reiniciar → Aplicar → Reiniciar → Listo

**Update con auto-apply (< 50 MB):**
> Checkear → Descargar → Aplicar → Reiniciar → Listo  *(1 reinicio menos)*

**Rollback remoto:**
> AdminServer ordena rollback → Heartbeat recibe instrucción → `pendiente-rollback.json` → Reiniciar → Restaurar backup → Reiniciar → Listo

**Fallo de arranque post-update:**
> `iniciarApp()` falla → `pendiente-rollback.json` automático → Reiniciar → Restaurar backup → Reiniciar → Listo
