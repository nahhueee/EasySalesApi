-- Migration: baja lógica de productos
-- Fecha: 2026-08-04
-- Motivo: los productos con historial de precios (producto_precio_historial) o con
--         ventas asociadas (ventas_detalle) no pueden eliminarse físicamente sin
--         romper la FK de historial o perder trazabilidad financiera. Se les aplica
--         baja lógica seteando fechaBaja; el listado los filtra automáticamente.
--         Mismo patrón que clientes (2026-07-10_clientes_baja_logica.sql).

ALTER TABLE productos
    ADD COLUMN fechaBaja DATETIME NULL DEFAULT NULL;
