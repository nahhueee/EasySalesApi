# Pruebas Fase 3.4-A (caja, backend) — para correr sobre copias de backups

Rama `fase3-4a-caja-backend`. Desde el entorno de desarrollo no hay MySQL: estas pruebas las corre Nahu
sobre las copias `diag_cliente_a/b/c` (y el backup del comercio con fondo de proveedores para los casos 6, 7, 10 y 22).
Tabla de resultados OK/FALLA = §8 de `documentos/handoff_fase3_4a_caja_backend.md` (más los casos nuevos de abajo).

## 1. Migrations (casos 18 y 19)
1. Restaurar una copia, `cd scripts && knex migrate:latest`.
2. En el log del backfill quedan los conteos (`[caja_origen_backfill] ...`). Para el PR: anotar por backup
   `vpd R1`, `vpd R2`, `vpd R3`, `vpd resto -> venta` y los de `mov`.
   `vpd R1+R2+R3` debe dar el mismo conteo de `cobro` que el informe 3.4-0 (A: 48 de R3, B: 8 de R3).
3. `SELECT origen, COUNT(*) FROM ventas_pagos_detalle GROUP BY origen;` y lo mismo en `cajas_movimientos`: no debe quedar NULL.
4. Re-ejecutar el backfill a mano (`UPDATE ... WHERE origen IS NULL`): 0 filas afectadas (idempotente).
5. `node scripts/diagnostico/diagnosticar.js --db <copia> --ref diag_referencia`: columnas `origen` y tabla `cajas_cierres`
   con la FK `fk_cajas_cierres_idCaja`, sin otras diferencias.
6. Caso 19: por cada caja finalizada, `GET /cajas/:id/resumen` -> `cajon.ventasEfectivo` debe coincidir con `efectivoNuevo` de C12.2.

## 2. Resumen y cierre (1–9, 14, 20)
- `GET /cajas/:id/resumen` con header `x-usuario-id`. Revisar `cajon`, `fondo`, `otrosMedios`, `info`, `control`.
- Caja anterior (o del mismo día) a la migration `20260622091000_ventas_total`: `caja.historica = true`,
  `info.totalVendido = control.ventasAcumulador`, `control.desvio = null`.
- Si la instalación NO tiene esa fila en `knex_migrations`, ninguna caja se marca histórica (queda `corteHistorico: null`).
- Cierre: `PUT /cajas/:id/cerrar` con `{"efectivoContado":215400}` / sin body. Forzar desvío:
  `UPDATE cajas SET ventas = ventas + 100 WHERE id = X` antes de cerrar -> cierra igual, `desvio = 100`,
  y aparece `CAJA_DESVIO_VENTAS` en el log de errores (nivel error, severidad MEDIA).

## 3. Caja inmutable (10, 11, 12, 15)
Con la caja cerrada: vender, anular una venta de esa caja, cargar/anular ingreso, cobrar fiado imputando, revertir ese cobro,
pagar/anular pago a proveedor imputado, `PUT /cajas/modificar`. Esperado: `CAJA_CERRADA` (409, o el mismo texto en los
flujos que devuelven string: cobros, proveedores, movimientos). Reabrir: sin motivo -> 400; EMPLEADO -> 403; ENCARGADO con
motivo -> OK + evento `CAJA_REABRIR`. Reabrir y cerrar de nuevo -> dos filas en `cajas_cierres`.
Front viejo: `PUT /cajas/finalizar` con `finalizada` 1 y 0.

## 4. Concurrencia (13, 16 y el caso nuevo de A1)
Con dos terminales o dos scripts que disparen requests a la vez (idealmente en bucle, 50–100 repeticiones):
- 13: cerrar la caja mientras otro puesto vende en ella -> la venta entra antes (y está en el resumen) o recibe 409.
- 16: dos `PUT /cuentas-cors/entrega` al mismo cliente -> se serializan, ninguna venta impaga se imputa dos veces.
- **A1:** venta a cuenta corriente + cobro del mismo cliente (imputado a la caja) simultáneos -> ninguno termina en 1213.
- Dos ventas simultáneas con productos [A, B] y [B, A] -> ninguna en 1213.

## 5. Varios
- 17: estadísticas por rango ya no suman cobros de fiado.
- 21: cambiar el reloj de la PC del puesto y vender -> `ventas.fecha/hora` siguen la hora de MySQL.
- 22: backup con fondo de proveedores: casos 6, 7 y 10.
