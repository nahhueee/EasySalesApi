-- Migration: baja lógica de clientes
-- Fecha: 2026-07-10
-- Motivo: los clientes con movimientos en cuenta corriente no pueden eliminarse
--         físicamente (FK constraint + auditoría financiera). Se les aplica baja
--         lógica seteando fechaBaja; el listado los filtra automáticamente.

ALTER TABLE clientes
    ADD COLUMN fechaBaja DATETIME NULL DEFAULT NULL;
