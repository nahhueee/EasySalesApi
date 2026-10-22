-- Consultas útiles sobre la tabla `eventos` (Fase 3.2-B).
-- Se corren a mano contra la base del comercio (MySQL Workbench, HeidiSQL, mysql CLI).
-- Cambiá los @parametros antes de ejecutar las consultas 2 y 3.
-- `fecha` la pone MySQL. idUsuario / idPuesto en NULL = "no se sabe" (request sin identidad).

SET @idVenta = 123;
SET @idCaja  = 1;

-- 1) Últimos 50 eventos, con nombre de usuario y de puesto ------------------------------------
SELECT e.id, e.fecha, e.accion, e.entidad, e.entidadId,
       COALESCE(u.nombre, IF(e.idUsuario IS NULL, '(sin usuario)', CONCAT('usuario #', e.idUsuario))) AS usuario,
       COALESCE(p.nombre, p.hostname, IF(e.idPuesto IS NULL, '(sin puesto)', LEFT(e.idPuesto, 8))) AS puesto,
       e.descripcion
FROM eventos e
LEFT JOIN usuarios u ON u.id = e.idUsuario
LEFT JOIN puestos  p ON p.id = e.idPuesto
ORDER BY e.id DESC
LIMIT 50;

-- 2) Historia completa de una venta: la venta, su factura/anulación, las NC y los cobros ---------
SELECT e.id, e.fecha, e.accion, e.entidad, e.entidadId, e.descripcion,
       e.datosAntes, e.datosDespues,
       COALESCE(u.nombre, '(sin usuario)') AS usuario
FROM eventos e
LEFT JOIN usuarios u ON u.id = e.idUsuario
WHERE (e.entidad = 'ventas' AND e.entidadId = @idVenta)
   OR (e.entidad = 'notas_credito' AND JSON_EXTRACT(e.datosDespues, '$.idVenta') = @idVenta)
ORDER BY e.id;

-- 3) Eventos de una caja: la caja misma, sus movimientos y las ventas que entraron ---------------
SELECT e.id, e.fecha, e.accion, e.entidad, e.entidadId, e.descripcion,
       COALESCE(u.nombre, '(sin usuario)') AS usuario
FROM eventos e
LEFT JOIN usuarios u ON u.id = e.idUsuario
WHERE (e.entidad = 'cajas' AND e.entidadId = @idCaja)
   OR (e.entidad IN ('cajas_movimientos', 'ventas')
       AND (JSON_EXTRACT(e.datosDespues, '$.idCaja') = @idCaja
            OR JSON_EXTRACT(e.datosAntes, '$.idCaja') = @idCaja))
ORDER BY e.id;

-- 4) Anulaciones y reversiones del día ---------------------------------------------------------
SELECT e.id, e.fecha, e.accion, e.entidad, e.entidadId, e.descripcion,
       COALESCE(u.nombre, '(sin usuario)') AS usuario,
       COALESCE(p.nombre, p.hostname, '(sin puesto)') AS puesto
FROM eventos e
LEFT JOIN usuarios u ON u.id = e.idUsuario
LEFT JOIN puestos  p ON p.id = e.idPuesto
WHERE e.accion IN ('VENTA_ANULAR', 'CAJA_MOVIMIENTO_ANULAR', 'CAJA_MOVIMIENTO_ELIMINAR', 'CAJA_ELIMINAR',
                   'CC_COBRO_REVERTIR', 'CC_VENTA_PAGO_REVERTIR',
                   'PROVEEDOR_PAGO_ANULAR', 'PROVEEDOR_FACTURA_ANULAR')
  AND DATE(e.fecha) = CURDATE()
ORDER BY e.id DESC;

-- 5) Cierres de caja: la foto del arqueo al cerrar contra la fila actual de `cajas` -------------
--    Si la caja no se tocó después de cerrar, las columnas coinciden.
SELECT e.id AS idEvento, e.fecha, e.entidadId AS idCaja,
       JSON_EXTRACT(e.datosDespues, '$.inicial')  AS inicial_cierre,  c.inicial  AS inicial_actual,
       JSON_EXTRACT(e.datosDespues, '$.ventas')   AS ventas_cierre,   c.ventas   AS ventas_actual,
       JSON_EXTRACT(e.datosDespues, '$.entradas') AS entradas_cierre, c.entradas AS entradas_actual,
       JSON_EXTRACT(e.datosDespues, '$.salidas')  AS salidas_cierre,  c.salidas  AS salidas_actual
FROM eventos e
JOIN cajas c ON c.id = e.entidadId
WHERE e.accion = 'CAJA_CERRAR'
ORDER BY e.id DESC
LIMIT 20;

-- 6) Salud de la identidad: eventos sin usuario o sin puesto, por acción (últimos 7 días) -------
SELECT e.accion,
       COUNT(*)                                  AS total,
       SUM(e.idUsuario IS NULL)                  AS sin_usuario,
       SUM(e.idPuesto  IS NULL)                  AS sin_puesto
FROM eventos e
WHERE e.fecha >= NOW() - INTERVAL 7 DAY
GROUP BY e.accion
ORDER BY total DESC;
