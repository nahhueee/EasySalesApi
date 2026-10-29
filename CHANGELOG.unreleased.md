<!--
CÓMO ANOTAR (vos, en el momento que cerrás algo — no al hacer el release):
* [mejora] descripción corta, en tu lenguaje técnico normal, sin pensar en redacción
* [correccion] descripción corta, en tu lenguaje técnico normal, sin pensar en redacción

Ejemplo real: "- [correccion] fix imask en vuelto de caja, se corrompía el number.toString()"
Ejemplo real: "- [mejora] permission check en pago/anulación a proveedor"

Solo esas dos etiquetas se procesan. Cualquier otra línea (como esta) se ignora.

PARA CLAUDE, cuando te pida "traducime el changelog pendiente" antes de un release:
1. Leé las líneas [mejora]/[correccion] de este archivo tal cual están (jerga incluida).
2. Reescribilas en lenguaje de cliente: dueño de comercio sin conocimiento técnico,
   no developer. Nada de nombres de función, tablas, componentes, SQL, stack, ni
   términos internos (imask, endpoint, query, repo, commit, permission check, etc.).
3. Enfocate en el beneficio o el problema resuelto desde la perspectiva del comercio,
   no en el mecanismo técnico.
   Técnico: "fix imask en vuelto de caja, se corrompía el number.toString()"
   Cliente: "Corregido un error que podía mostrar mal el vuelto en caja"
   Técnico: "permission check en pago/anulación a proveedor"
   Cliente: "Nuevo permiso para controlar quién puede pagar o anular pagos a proveedores"
4. Agrupá todo lo [mejora] en un texto y todo lo [correccion] en otro, separados por
   " | " si hay varias — son los campos que van a `mejoras` y `correcciones` en
   adminserver, cada uno con tope de 400 caracteres.
5. Dame el resultado para pegar en el panel admin (el registro nace en estado
   'borrador', así que igual lo repaso ahí antes de promoverlo a canary/producción).

No edites este archivo vos mismo salvo que te lo pida explícitamente — el que lo
vacía y archiva en CHANGELOG.md es el script de release (build-changelog.js).
-->
- [mejora] fase 3.3: historial de stock (productos_movimientos) con StockRepo.Mover como único punto de cambio de cantidad; GET /productos/:id/movimientos-stock; NC con reingreso opcional de mercadería
- [correccion] fix lost update del stock: el modal de producto y "agregar cantidad" ya no pisan la cantidad con un valor viejo (Modificar no escribe cantidad si no se tocó; aniadir recibe delta)
