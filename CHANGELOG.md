# Changelog

## 2.8.16 — 2026-09-04

**Mejoras**
- Pruebas de mensajes

## 2.8.17 — 2026-09-15

_(sin entradas registradas para esta versión)_

## 2.8.18 — 2026-09-16

_(sin entradas registradas para esta versión)_

## 2.8.19 — 2026-09-16

_(sin entradas registradas para esta versión)_

## 2.8.20 — 2026-09-23

_(sin entradas registradas para esta versión)_

## 2.8.21 — 2026-09-25

_(sin entradas registradas para esta versión)_

## 2.8.22 — 2026-09-30

_(sin entradas registradas para esta versión)_

## 2.8.23 — 2026-10-07

**Mejoras**
- Eliminar cliente ahora se bloquea (CON_SALDO) si tiene saldo distinto de 0 en cuenta corriente, deuda o saldo a favor; antes se daba de baja igual y quedaba oculto con el saldo sin seguimiento.
- Nuevo POST /cuentas/ajuste: ajuste manual del saldo de cuenta corriente de un cliente (solo ADMINISTRADOR, validado en backend). Modo 'monto' (debe/haber) o modo 'cero' que calcula en la transacción el movimiento que deja el saldo en 0. Solo escribe el ledger (tipo 'ajuste', descripcion 'Ajuste manual - <obs>'); no modifica ventas_pago.

**Correcciones**
- Eliminar() de clientes/productos solo miraba algunas tablas de referencia (cuenta_corriente_movimientos en clientes; producto_precio_historial + ventas_detalle en productos). Ahora revisa TODAS las tablas que referencian (clientes: ventas, ventas_entrega, cuenta_corriente_movimientos, presupuestos — productos: ventas_detalle, producto_precio_historial, presupuestos_detalle, notas_credito_detalle, importaciones_costos_detalle) antes de decidir borrado físico vs baja lógica. Se protegen Consumidor Final (id 1) y el producto Varios (codigo '*'). El borrado físico de producto ahora corre en una sola transacción (antes, si el DELETE de productos fallaba por una FK no prevista, el DELETE de productos_precios ya aplicado no se revertía).
- La entrega de dinero a cuenta corriente ahora rechaza montos menores o iguales a 0 (antes el backend no validaba el monto).

