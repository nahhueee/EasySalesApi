-- ============================================================
-- Script manual equivalente a la migración Knex
-- 20260605120000_presupuestos.js
-- Ejecutar en MySQL (idempotente: usa IF NOT EXISTS)
-- ============================================================

-- ===========================
-- 1. Tabla presupuestos
-- ===========================
CREATE TABLE IF NOT EXISTS `presupuestos` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `idCliente`        INT UNSIGNED NOT NULL,
  `idUsuario`        INT UNSIGNED NOT NULL,
  `idCaja`           INT UNSIGNED NULL,                  -- NULL si se creó fuera de una caja
  `fecha`            DATE NOT NULL,
  `validezHasta`     DATE NOT NULL,
  `total`            DECIMAL(10,2) NOT NULL,
  `estado`           ENUM('vigente','convertido','anulado','vencido') NOT NULL DEFAULT 'vigente',
  `idVentaGenerada`  INT UNSIGNED NULL,                  -- Se setea al convertir
  PRIMARY KEY (`id`),
  CONSTRAINT `presupuestos_idcliente_foreign`
    FOREIGN KEY (`idCliente`) REFERENCES `clientes` (`id`),
  CONSTRAINT `presupuestos_idventagenerada_foreign`
    FOREIGN KEY (`idVentaGenerada`) REFERENCES `ventas` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===========================
-- 2. Tabla presupuestos_detalle
-- ===========================
CREATE TABLE IF NOT EXISTS `presupuestos_detalle` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `idPresupuesto`  INT UNSIGNED NOT NULL,
  `idProducto`     INT UNSIGNED NOT NULL,   -- Solo productos reales: vario y soloPrecio quedan excluidos
  `nomProd`        VARCHAR(200) NOT NULL,   -- Snapshot del nombre
  `cantidad`       DECIMAL(10,3) NOT NULL,
  `precio`         DECIMAL(10,2) NOT NULL,  -- Snapshot del precio cotizado (sin IVA)
  `costo`          DECIMAL(10,2) NOT NULL,
  `total`          DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `presupuestos_detalle_idpresupuesto_foreign`
    FOREIGN KEY (`idPresupuesto`) REFERENCES `presupuestos` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
