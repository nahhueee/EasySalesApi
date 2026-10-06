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

- [correccion] Eliminar() de clientes/productos solo miraba algunas tablas de referencia (cuenta_corriente_movimientos en clientes; producto_precio_historial + ventas_detalle en productos). Ahora revisa TODAS las tablas que referencian (clientes: ventas, ventas_entrega, cuenta_corriente_movimientos, presupuestos — productos: ventas_detalle, producto_precio_historial, presupuestos_detalle, notas_credito_detalle, importaciones_costos_detalle) antes de decidir borrado físico vs baja lógica. Se protegen Consumidor Final (id 1) y el producto Varios (codigo '*'). El borrado físico de producto ahora corre en una sola transacción (antes, si el DELETE de productos fallaba por una FK no prevista, el DELETE de productos_precios ya aplicado no se revertía).

- [mejora] Eliminar cliente ahora se bloquea (CON_SALDO) si tiene saldo distinto de 0 en cuenta corriente, deuda o saldo a favor; antes se daba de baja igual y quedaba oculto con el saldo sin seguimiento.
