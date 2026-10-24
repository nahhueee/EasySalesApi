-- Fase 3.2-D: carga de prueba para el caso 12 (50 mil eventos, el listado de 7 días debe cargar en < 1 s).
-- Correr SOLO en una copia de un backup, nunca en producción.

-- 1) Insert masivo: 50.000 eventos repartidos en los últimos 30 días, marcados con 'PRUEBA-3.2D'.
SET SESSION cte_max_recursion_depth = 60000;
INSERT INTO eventos (fecha, idUsuario, idPuesto, accion, entidad, entidadId, datosAntes, datosDespues, descripcion)
WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 50000)
SELECT NOW() - INTERVAL (i % 43200) MINUTE,
       NULL, NULL,
       ELT(1 + i % 3, 'VENTA_CREAR', 'CAJA_MOVIMIENTO_CREAR', 'VENTA_ANULAR'),
       ELT(1 + i % 3, 'ventas', 'cajas_movimientos', 'ventas'),
       i,
       NULL,
       JSON_OBJECT('total', i % 1000, 'idCaja', 1 + i % 50),
       CONCAT('PRUEBA-3.2D evento ', i)
FROM n;

-- 2) Medir (ver tiempos y plan): esto es lo que ejecuta POST /eventos/obtener sin filtros.
EXPLAIN SELECT e.id FROM eventos e WHERE e.fecha >= CURDATE() - INTERVAL 6 DAY ORDER BY e.fecha DESC, e.id DESC LIMIT 25;
SELECT COUNT(*) FROM eventos e WHERE e.fecha >= CURDATE() - INTERVAL 6 DAY;

-- 3) Limpieza
DELETE FROM eventos WHERE descripcion LIKE 'PRUEBA-3.2D%';
