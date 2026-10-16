// MIGRATION BASE — CONGELADA. NO EDITAR. NO REGENERAR.
//
// Fase 3.1-B. Foto del schema objetivo de EasySales (bootstrap + todas las migrations hasta la
// reconciliación 3.1-A), generada UNA vez el 2026-10-14 desde la base "diag_referencia" con
// scripts/diagnostico/generar-base.js. Ese script queda solo como trazabilidad.
//
// Reglas (architecture.md §13):
//  - Esta migration no se edita ni se regenera nunca. Cambiar el schema = escribir otra migration.
//  - Una migration que ya corrió en algún ambiente no cambia su efecto; solo se le pueden agregar
//    guardas de idempotencia.
//  - Nunca fijar CHARSET ni COLLATE en un DDL: todo hereda el default de la base.
//
// Cómo funciona (todo o nada):
//  - Si existe la tabla `ventas`  -> instalación existente: no-op. (Su timestamp es anterior a
//    todas las demás: knex la corre primero, pero en una base existente no hace nada.)
//  - Si la base no tiene NINGUNA tabla (ignorando knex_migrations*) -> crea todo + semillas.
//  - Cualquier otro caso (base a medias) -> error. Una base a medias es un error de instalación
//    y tiene que verse, no tolerarse con CREATE TABLE IF NOT EXISTS.
//
// Orden al crear: tablas sin FKs -> semillas (ids explícitos) -> FKs. Después corren las demás
// migrations, que sobre este schema son no-op (tienen guardas de existencia).

const TABLAS = [
  "CREATE TABLE `backups` (\n  `nombre` varchar(30) NOT NULL,\n  `fecha` date DEFAULT NULL,\n  PRIMARY KEY (`nombre`)\n) ENGINE=InnoDB",
  "CREATE TABLE `cajas` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `idResponsable` int unsigned DEFAULT NULL,\n  `fecha` date DEFAULT NULL,\n  `hora` varchar(5) DEFAULT NULL,\n  `fechaBaja` date DEFAULT NULL,\n  `inicial` decimal(10,2) DEFAULT NULL,\n  `ventas` decimal(10,2) DEFAULT NULL,\n  `entradas` decimal(10,2) DEFAULT NULL,\n  `salidas` decimal(10,2) DEFAULT NULL,\n  `finalizada` tinyint(1) DEFAULT NULL,\n  `fondoProveedores` decimal(10,2) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `idx_cajas_idResponsable` (`idResponsable`),\n  KEY `idx_cajas_fecha` (`fecha`)\n) ENGINE=InnoDB",
  "CREATE TABLE `cajas_movimientos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idCaja` int DEFAULT NULL,\n  `tipoMovimiento` varchar(10) DEFAULT NULL,\n  `monto` decimal(10,2) DEFAULT NULL,\n  `descripcion` varchar(150) DEFAULT NULL,\n  `idProveedorMovimiento` int unsigned DEFAULT NULL,\n  `idEntrega` int DEFAULT NULL,\n  `idVentaPagoDetalle` int unsigned DEFAULT NULL,\n  `idMovimientoCompensado` int unsigned DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `cajas_movimientos_identrega_foreign` (`idEntrega`),\n  KEY `cajas_movimientos_idventapagodetalle_foreign` (`idVentaPagoDetalle`),\n  KEY `cajas_movimientos_idmovimientocompensado_foreign` (`idMovimientoCompensado`),\n  KEY `idx_cajas_movimientos_idCaja` (`idCaja`),\n  KEY `fk_cajas_movimientos_idProveedorMovimiento` (`idProveedorMovimiento`)\n) ENGINE=InnoDB",
  "CREATE TABLE `cargos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `categorias` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) NOT NULL,\n  `color` varchar(7) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `clientes` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) DEFAULT NULL,\n  `tipoDocumento` int DEFAULT NULL,\n  `nroDocumento` bigint DEFAULT NULL,\n  `condicionIva` int DEFAULT NULL,\n  `razonSocial` varchar(100) DEFAULT NULL,\n  `fechaBaja` datetime DEFAULT NULL,\n  `direccion` varchar(150) DEFAULT NULL,\n  `idLista` int unsigned DEFAULT NULL,\n  `telefono` varchar(30) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `clientes_idlista_foreign` (`idLista`)\n) ENGINE=InnoDB",
  "CREATE TABLE `cuenta_corriente_movimientos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idCliente` int unsigned NOT NULL,\n  `fecha` date NOT NULL,\n  `hora` varchar(5) NOT NULL,\n  `tipo` enum('apertura','venta','entrega','nota_credito','ajuste') NOT NULL,\n  `descripcion` varchar(200) DEFAULT NULL,\n  `debe` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `haber` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `idReferencia` int DEFAULT NULL,\n  `saldo` decimal(10,2) NOT NULL,\n  PRIMARY KEY (`id`),\n  KEY `cuenta_corriente_movimientos_idcliente_id_index` (`idCliente`,`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `etiquetas` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `descripcion` varchar(50) DEFAULT NULL,\n  `tamanio` varchar(15) DEFAULT NULL,\n  `titulo` varchar(50) DEFAULT NULL,\n  `mOferta` int DEFAULT NULL,\n  `mCodigo` int DEFAULT NULL,\n  `mPrecio` int DEFAULT NULL,\n  `mNombre` int DEFAULT NULL,\n  `mVencimiento` int DEFAULT NULL,\n  `bordeColor` varchar(10) DEFAULT NULL,\n  `bordeAncho` varchar(10) DEFAULT NULL,\n  `tituloColor` varchar(10) DEFAULT NULL,\n  `tituloAlineacion` varchar(10) DEFAULT NULL,\n  `ofertaFondo` varchar(10) DEFAULT NULL,\n  `ofertaAlineacion` varchar(10) DEFAULT NULL,\n  `nombreAlineacion` varchar(10) DEFAULT NULL,\n  `vencimientoAlineacion` varchar(10) DEFAULT NULL,\n  `precioAlineacion` varchar(10) DEFAULT NULL,\n  `precioColor` varchar(10) DEFAULT NULL,\n  `papel` varchar(10) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `importaciones_costos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idProveedor` int unsigned NOT NULL,\n  `nombreArchivo` varchar(120) DEFAULT NULL,\n  `fecha` datetime NOT NULL,\n  `idUsuario` int unsigned NOT NULL DEFAULT '0',\n  `filasArchivo` int NOT NULL DEFAULT '0',\n  `filasAplicadas` int NOT NULL DEFAULT '0',\n  `deshecha` tinyint(1) NOT NULL DEFAULT '0',\n  `fechaDeshecha` datetime DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `importaciones_costos_idproveedor_fecha_index` (`idProveedor`,`fecha`)\n) ENGINE=InnoDB",
  "CREATE TABLE `importaciones_costos_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idImportacion` int unsigned NOT NULL,\n  `idProducto` int unsigned NOT NULL,\n  `codigoArchivo` varchar(40) DEFAULT NULL,\n  `costoAnterior` decimal(10,2) DEFAULT NULL,\n  `precioAnterior` decimal(10,2) DEFAULT NULL,\n  `tipoPrecioAnterior` varchar(1) DEFAULT NULL,\n  `porcentajeAnterior` decimal(10,2) DEFAULT NULL,\n  `redondeoAnterior` int DEFAULT NULL,\n  `costoNuevo` decimal(10,2) DEFAULT NULL,\n  `precioNuevo` decimal(10,2) DEFAULT NULL,\n  `creoRelacionProveedor` tinyint(1) NOT NULL DEFAULT '0',\n  PRIMARY KEY (`id`),\n  KEY `importaciones_costos_detalle_idproducto_foreign` (`idProducto`),\n  KEY `importaciones_costos_detalle_idimportacion_index` (`idImportacion`)\n) ENGINE=InnoDB",
  "CREATE TABLE `listas_precio` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) NOT NULL,\n  `esDefault` tinyint(1) NOT NULL DEFAULT '0',\n  `activa` tinyint(1) NOT NULL DEFAULT '1',\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `notas_credito` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idVenta` int unsigned NOT NULL,\n  `tipo` int NOT NULL,\n  `cae` bigint NOT NULL,\n  `caeVto` date NOT NULL,\n  `ticket` int NOT NULL,\n  `ptoVenta` int NOT NULL,\n  `neto` decimal(10,2) NOT NULL,\n  `iva` decimal(10,2) NOT NULL,\n  `total` decimal(10,2) NOT NULL,\n  `esParcial` tinyint(1) NOT NULL DEFAULT '0',\n  `fecha` datetime NOT NULL,\n  `motivo` varchar(200) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `notas_credito_idventa_index` (`idVenta`)\n) ENGINE=InnoDB",
  "CREATE TABLE `notas_credito_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idNotaCredito` int unsigned NOT NULL,\n  `idVentaDetalle` int unsigned NOT NULL,\n  `idProducto` int unsigned NOT NULL,\n  `nomProd` varchar(100) NOT NULL,\n  `cantidad` decimal(10,3) DEFAULT NULL,\n  `precio` decimal(10,2) NOT NULL,\n  PRIMARY KEY (`id`),\n  KEY `notas_credito_detalle_idnotacredito_foreign` (`idNotaCredito`),\n  KEY `notas_credito_detalle_idventadetalle_index` (`idVentaDetalle`)\n) ENGINE=InnoDB",
  "CREATE TABLE `parametros` (\n  `clave` varchar(30) NOT NULL,\n  `valor` varchar(50) NOT NULL DEFAULT '',\n  PRIMARY KEY (`clave`)\n) ENGINE=InnoDB",
  "CREATE TABLE `parametros_facturacion` (\n  `condicion` varchar(50) DEFAULT NULL,\n  `puntoVta` int DEFAULT NULL,\n  `cuil` bigint DEFAULT NULL,\n  `razon` varchar(100) DEFAULT NULL,\n  `direccion` varchar(250) DEFAULT NULL\n) ENGINE=InnoDB",
  "CREATE TABLE `parametros_impresion` (\n  `impresora` varchar(100) DEFAULT NULL,\n  `papel` varchar(10) DEFAULT NULL,\n  `margenIzq` int DEFAULT '0',\n  `margenDer` int DEFAULT '0',\n  `nomLocal` varchar(100) DEFAULT NULL,\n  `desLocal` varchar(100) DEFAULT NULL,\n  `dirLocal` varchar(150) DEFAULT NULL,\n  `mostrarObservaciones` tinyint(1) NOT NULL DEFAULT '1',\n  `telefonoLocal` varchar(30) DEFAULT NULL,\n  `mensajeExtra` varchar(200) DEFAULT NULL,\n  `textoObservaciones` varchar(60) NOT NULL DEFAULT 'Observaciones',\n  `mostrarDireccion` tinyint(1) NOT NULL DEFAULT '1',\n  `mostrarTelefono` tinyint(1) NOT NULL DEFAULT '1',\n  `mostrarMensaje` tinyint(1) NOT NULL DEFAULT '1',\n  `logo` varchar(100) DEFAULT NULL,\n  `mostrarLogo` tinyint(1) NOT NULL DEFAULT '1',\n  `mostrarNombre` tinyint(1) NOT NULL DEFAULT '1'\n) ENGINE=InnoDB",
  "CREATE TABLE `presupuestos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idCliente` int unsigned NOT NULL,\n  `idUsuario` int unsigned NOT NULL,\n  `idCaja` int unsigned DEFAULT NULL,\n  `fecha` date NOT NULL,\n  `validezHasta` date NOT NULL,\n  `total` decimal(10,2) NOT NULL,\n  `estado` enum('vigente','convertido','anulado','vencido') NOT NULL DEFAULT 'vigente',\n  `idVentaGenerada` int unsigned DEFAULT NULL,\n  `fechaModificacion` datetime DEFAULT NULL,\n  `idUsuarioModifico` int unsigned DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `presupuestos_idcliente_foreign` (`idCliente`),\n  KEY `presupuestos_idventagenerada_foreign` (`idVentaGenerada`)\n) ENGINE=InnoDB",
  "CREATE TABLE `presupuestos_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idPresupuesto` int unsigned NOT NULL,\n  `idProducto` int unsigned NOT NULL,\n  `nomProd` varchar(200) NOT NULL,\n  `cantidad` decimal(10,3) NOT NULL,\n  `precio` decimal(10,2) NOT NULL,\n  `costo` decimal(10,2) NOT NULL,\n  `total` decimal(10,2) NOT NULL,\n  PRIMARY KEY (`id`),\n  KEY `presupuestos_detalle_idpresupuesto_foreign` (`idPresupuesto`)\n) ENGINE=InnoDB",
  "CREATE TABLE `producto_precio_historial` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idProducto` int unsigned NOT NULL,\n  `idLista` int unsigned NOT NULL,\n  `tipoPrecio` varchar(1) NOT NULL,\n  `porcentaje` decimal(10,2) DEFAULT NULL,\n  `costo` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `sumarIva` tinyint(1) NOT NULL DEFAULT '0',\n  `precio` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `redondeo` int NOT NULL DEFAULT '0',\n  `fecha` datetime NOT NULL,\n  `idUsuario` int unsigned NOT NULL DEFAULT '0',\n  `origen` varchar(20) NOT NULL,\n  PRIMARY KEY (`id`),\n  KEY `idx_historial_producto_lista_fecha` (`idProducto`,`idLista`,`fecha`),\n  KEY `producto_precio_historial_idlista_foreign` (`idLista`)\n) ENGINE=InnoDB",
  "CREATE TABLE `productos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `codigo` varchar(30) DEFAULT NULL,\n  `nombre` varchar(100) DEFAULT NULL,\n  `cantidad` decimal(10,3) DEFAULT NULL,\n  `tipoPrecio` varchar(2) DEFAULT NULL,\n  `sumarIva` int DEFAULT '0',\n  `costo` decimal(10,2) DEFAULT NULL,\n  `precio` decimal(10,2) DEFAULT NULL,\n  `redondeo` int DEFAULT NULL,\n  `porcentaje` decimal(6,2) DEFAULT NULL,\n  `vencimiento` date DEFAULT NULL,\n  `faltante` int DEFAULT NULL,\n  `unidad` varchar(3) DEFAULT NULL,\n  `imagen` varchar(250) DEFAULT NULL,\n  `soloPrecio` tinyint(1) DEFAULT NULL,\n  `idCategoria` int unsigned DEFAULT '0',\n  `fechaBaja` datetime DEFAULT NULL,\n  `idProveedor` int unsigned DEFAULT NULL,\n  `marca` varchar(40) DEFAULT NULL,\n  `vehiculo` varchar(80) DEFAULT NULL,\n  `aplicacion` varchar(300) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `productos_idproveedor_foreign` (`idProveedor`),\n  KEY `idx_productos_codigo` (`codigo`),\n  KEY `idx_productos_idCategoria` (`idCategoria`)\n) ENGINE=InnoDB",
  "CREATE TABLE `productos_precios` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idProducto` int unsigned NOT NULL,\n  `idLista` int unsigned NOT NULL,\n  `tipoPrecio` varchar(1) NOT NULL DEFAULT '$',\n  `costo` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `precio` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `porcentaje` decimal(10,2) DEFAULT NULL,\n  `redondeo` int NOT NULL DEFAULT '0',\n  `sumarIva` tinyint(1) NOT NULL DEFAULT '0',\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `productos_precios_idproducto_idlista_unique` (`idProducto`,`idLista`),\n  KEY `productos_precios_idlista_foreign` (`idLista`)\n) ENGINE=InnoDB",
  "CREATE TABLE `productos_proveedores` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idProducto` int unsigned NOT NULL,\n  `idProveedor` int unsigned NOT NULL,\n  `codigoProveedor` varchar(40) DEFAULT NULL,\n  `costo` decimal(10,2) DEFAULT NULL,\n  `esPrincipal` tinyint(1) NOT NULL DEFAULT '0',\n  `fechaActualizacion` datetime DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `productos_proveedores_idproducto_idproveedor_unique` (`idProducto`,`idProveedor`),\n  KEY `productos_proveedores_idproveedor_index` (`idProveedor`)\n) ENGINE=InnoDB",
  "CREATE TABLE `proveedor_cuenta_movimientos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idProveedor` int unsigned NOT NULL,\n  `fecha` date NOT NULL,\n  `hora` varchar(5) NOT NULL,\n  `tipo` varchar(20) NOT NULL,\n  `descripcion` varchar(200) DEFAULT NULL,\n  `comprobante` varchar(30) DEFAULT NULL,\n  `fechaVencimiento` date DEFAULT NULL,\n  `debe` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `haber` decimal(10,2) NOT NULL DEFAULT '0.00',\n  `saldo` decimal(10,2) NOT NULL,\n  `idTipoPago` int unsigned DEFAULT NULL,\n  `idCaja` int DEFAULT NULL,\n  `idReferencia` int unsigned DEFAULT NULL,\n  `idCompra` int DEFAULT NULL,\n  `anulado` tinyint(1) NOT NULL DEFAULT '0',\n  PRIMARY KEY (`id`),\n  KEY `idx_proveedor_movimientos` (`idProveedor`,`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `proveedores` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) NOT NULL,\n  `razonSocial` varchar(150) DEFAULT NULL,\n  `cuit` varchar(13) DEFAULT NULL,\n  `telefono` varchar(30) DEFAULT NULL,\n  `email` varchar(100) DEFAULT NULL,\n  `direccion` varchar(200) DEFAULT NULL,\n  `fechaBaja` datetime DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `registros` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `descripcion` varchar(80) DEFAULT NULL,\n  `prioridad` int DEFAULT NULL,\n  `total` decimal(10,2) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `registros_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idRegistro` int unsigned DEFAULT NULL,\n  `accion` varchar(6) DEFAULT NULL,\n  `monto` decimal(10,2) DEFAULT NULL,\n  `observacion` varchar(80) DEFAULT NULL,\n  `fecha` date DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `tipos_pago` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(20) DEFAULT NULL,\n  `icono` varchar(15) DEFAULT NULL,\n  `color` varchar(15) DEFAULT NULL,\n  `orden` int DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `usuarios` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `nombre` varchar(100) DEFAULT NULL,\n  `email` varchar(100) DEFAULT NULL,\n  `pass` varchar(72) DEFAULT NULL,\n  `idCargo` int unsigned DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `usuarios_movimientos` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `fecha` datetime DEFAULT NULL,\n  `idUsuario` int DEFAULT NULL,\n  `accion` varchar(255) DEFAULT NULL,\n  `idPuesto` varchar(36) DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idCaja` int DEFAULT NULL,\n  `idCliente` int unsigned DEFAULT NULL,\n  `fecha` date DEFAULT NULL,\n  `hora` varchar(8) DEFAULT NULL,\n  `fechaBaja` date DEFAULT NULL,\n  `obsBaja` varchar(200) DEFAULT NULL,\n  `total` decimal(10,2) DEFAULT NULL,\n  `idLista` int unsigned DEFAULT NULL,\n  `idempotencyKey` varchar(36) DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE KEY `ventas_idempotencykey_unique` (`idempotencyKey`),\n  KEY `ventas_idlista_foreign` (`idLista`),\n  KEY `idx_ventas_idCaja` (`idCaja`),\n  KEY `idx_ventas_idCliente` (`idCliente`),\n  KEY `idx_ventas_fecha` (`fecha`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idVenta` int unsigned NOT NULL,\n  `idProducto` int unsigned DEFAULT NULL,\n  `nomProd` varchar(100) DEFAULT NULL,\n  `cantidad` decimal(10,3) DEFAULT NULL,\n  `costo` decimal(10,2) DEFAULT NULL,\n  `precio` decimal(10,2) DEFAULT NULL,\n  PRIMARY KEY (`id`,`idVenta`),\n  KEY `idx_ventas_detalle_idVenta` (`idVenta`),\n  KEY `idx_ventas_detalle_idProducto` (`idProducto`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_entrega` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `idCliente` int unsigned NOT NULL,\n  `monto` decimal(10,2) NOT NULL,\n  `fecha` timestamp NULL DEFAULT CURRENT_TIMESTAMP,\n  `idCaja` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `ventas_entrega_idcaja_foreign` (`idCaja`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_entrega_detalle` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  `idEntrega` int NOT NULL,\n  `idVenta` int unsigned NOT NULL,\n  `montoAplicado` decimal(10,2) NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_factura` (\n  `idVenta` int unsigned NOT NULL,\n  `cae` bigint DEFAULT NULL,\n  `caeVto` date DEFAULT NULL,\n  `ticket` int DEFAULT NULL,\n  `tipoFactura` int DEFAULT NULL,\n  `neto` decimal(10,2) DEFAULT NULL,\n  `iva` decimal(10,2) DEFAULT NULL,\n  `dni` bigint DEFAULT NULL,\n  `tipoDni` int DEFAULT NULL,\n  `ptoVenta` int DEFAULT NULL,\n  `condReceptor` int DEFAULT '0',\n  `receptorNombre` varchar(150) DEFAULT NULL,\n  `receptorDireccion` varchar(150) DEFAULT NULL,\n  PRIMARY KEY (`idVenta`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_pago` (\n  `idVenta` int unsigned NOT NULL,\n  `descuento` decimal(10,2) DEFAULT '0.00',\n  `recargo` decimal(10,2) DEFAULT '0.00',\n  `entrega` decimal(10,2) DEFAULT NULL,\n  `monto` decimal(10,2) DEFAULT '0.00',\n  `tipoModificador` enum('porcentaje','monto') DEFAULT NULL,\n  `realizado` tinyint(1) DEFAULT NULL,\n  `pagaCon` decimal(10,2) DEFAULT NULL,\n  PRIMARY KEY (`idVenta`)\n) ENGINE=InnoDB",
  "CREATE TABLE `ventas_pagos_detalle` (\n  `id` int unsigned NOT NULL AUTO_INCREMENT,\n  `idVenta` int unsigned NOT NULL,\n  `idTPago` int unsigned NOT NULL,\n  `idEntrega` int DEFAULT NULL,\n  `monto` decimal(10,2) NOT NULL,\n  `fecha` datetime DEFAULT CURRENT_TIMESTAMP,\n  `idCaja` int DEFAULT NULL,\n  PRIMARY KEY (`id`),\n  KEY `ventas_pagos_detalle_idcaja_foreign` (`idCaja`),\n  KEY `idx_ventas_pagos_detalle_idVenta` (`idVenta`)\n) ENGINE=InnoDB"
];

const FKS = [
  "ALTER TABLE `cajas_movimientos` ADD CONSTRAINT `cajas_movimientos_identrega_foreign` FOREIGN KEY (`idEntrega`) REFERENCES `ventas_entrega` (`id`) ON DELETE SET NULL",
  "ALTER TABLE `cajas_movimientos` ADD CONSTRAINT `cajas_movimientos_idmovimientocompensado_foreign` FOREIGN KEY (`idMovimientoCompensado`) REFERENCES `cajas_movimientos` (`id`) ON DELETE SET NULL",
  "ALTER TABLE `cajas_movimientos` ADD CONSTRAINT `cajas_movimientos_idventapagodetalle_foreign` FOREIGN KEY (`idVentaPagoDetalle`) REFERENCES `ventas_pagos_detalle` (`id`) ON DELETE SET NULL",
  "ALTER TABLE `cajas_movimientos` ADD CONSTRAINT `fk_cajas_movimientos_idProveedorMovimiento` FOREIGN KEY (`idProveedorMovimiento`) REFERENCES `proveedor_cuenta_movimientos` (`id`)",
  "ALTER TABLE `clientes` ADD CONSTRAINT `clientes_idlista_foreign` FOREIGN KEY (`idLista`) REFERENCES `listas_precio` (`id`)",
  "ALTER TABLE `cuenta_corriente_movimientos` ADD CONSTRAINT `cuenta_corriente_movimientos_idcliente_foreign` FOREIGN KEY (`idCliente`) REFERENCES `clientes` (`id`)",
  "ALTER TABLE `importaciones_costos` ADD CONSTRAINT `importaciones_costos_idproveedor_foreign` FOREIGN KEY (`idProveedor`) REFERENCES `proveedores` (`id`)",
  "ALTER TABLE `importaciones_costos_detalle` ADD CONSTRAINT `importaciones_costos_detalle_idimportacion_foreign` FOREIGN KEY (`idImportacion`) REFERENCES `importaciones_costos` (`id`)",
  "ALTER TABLE `importaciones_costos_detalle` ADD CONSTRAINT `importaciones_costos_detalle_idproducto_foreign` FOREIGN KEY (`idProducto`) REFERENCES `productos` (`id`)",
  "ALTER TABLE `notas_credito` ADD CONSTRAINT `notas_credito_idventa_foreign` FOREIGN KEY (`idVenta`) REFERENCES `ventas` (`id`)",
  "ALTER TABLE `notas_credito_detalle` ADD CONSTRAINT `notas_credito_detalle_idnotacredito_foreign` FOREIGN KEY (`idNotaCredito`) REFERENCES `notas_credito` (`id`)",
  "ALTER TABLE `presupuestos` ADD CONSTRAINT `presupuestos_idcliente_foreign` FOREIGN KEY (`idCliente`) REFERENCES `clientes` (`id`)",
  "ALTER TABLE `presupuestos` ADD CONSTRAINT `presupuestos_idventagenerada_foreign` FOREIGN KEY (`idVentaGenerada`) REFERENCES `ventas` (`id`)",
  "ALTER TABLE `presupuestos_detalle` ADD CONSTRAINT `presupuestos_detalle_idpresupuesto_foreign` FOREIGN KEY (`idPresupuesto`) REFERENCES `presupuestos` (`id`)",
  "ALTER TABLE `producto_precio_historial` ADD CONSTRAINT `producto_precio_historial_idlista_foreign` FOREIGN KEY (`idLista`) REFERENCES `listas_precio` (`id`)",
  "ALTER TABLE `producto_precio_historial` ADD CONSTRAINT `producto_precio_historial_idproducto_foreign` FOREIGN KEY (`idProducto`) REFERENCES `productos` (`id`)",
  "ALTER TABLE `productos` ADD CONSTRAINT `productos_idproveedor_foreign` FOREIGN KEY (`idProveedor`) REFERENCES `proveedores` (`id`) ON DELETE SET NULL",
  "ALTER TABLE `productos_precios` ADD CONSTRAINT `productos_precios_idlista_foreign` FOREIGN KEY (`idLista`) REFERENCES `listas_precio` (`id`)",
  "ALTER TABLE `productos_precios` ADD CONSTRAINT `productos_precios_idproducto_foreign` FOREIGN KEY (`idProducto`) REFERENCES `productos` (`id`)",
  "ALTER TABLE `productos_proveedores` ADD CONSTRAINT `productos_proveedores_idproducto_foreign` FOREIGN KEY (`idProducto`) REFERENCES `productos` (`id`)",
  "ALTER TABLE `productos_proveedores` ADD CONSTRAINT `productos_proveedores_idproveedor_foreign` FOREIGN KEY (`idProveedor`) REFERENCES `proveedores` (`id`)",
  "ALTER TABLE `proveedor_cuenta_movimientos` ADD CONSTRAINT `fk_proveedor_cuenta_movimientos_idProveedor` FOREIGN KEY (`idProveedor`) REFERENCES `proveedores` (`id`)",
  "ALTER TABLE `ventas` ADD CONSTRAINT `ventas_idlista_foreign` FOREIGN KEY (`idLista`) REFERENCES `listas_precio` (`id`)",
  "ALTER TABLE `ventas_entrega` ADD CONSTRAINT `ventas_entrega_idcaja_foreign` FOREIGN KEY (`idCaja`) REFERENCES `cajas` (`id`)",
  "ALTER TABLE `ventas_pagos_detalle` ADD CONSTRAINT `fk_ventas_pagos_detalle_idVenta` FOREIGN KEY (`idVenta`) REFERENCES `ventas` (`id`)",
  "ALTER TABLE `ventas_pagos_detalle` ADD CONSTRAINT `ventas_pagos_detalle_idcaja_foreign` FOREIGN KEY (`idCaja`) REFERENCES `cajas` (`id`)"
];

const SEMILLAS = {
  "cargos": {
    "columnas": [
      "id",
      "nombre"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "ADMINISTRADOR"
      },
      {
        "id": 2,
        "nombre": "ENCARGADO"
      },
      {
        "id": 3,
        "nombre": "EMPLEADO"
      }
    ]
  },
  "categorias": {
    "columnas": [
      "id",
      "nombre",
      "color"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "SIN CATEGORIZAR",
        "color": null
      }
    ]
  },
  "clientes": {
    "columnas": [
      "id",
      "nombre",
      "tipoDocumento",
      "nroDocumento",
      "condicionIva",
      "razonSocial",
      "fechaBaja",
      "direccion",
      "idLista",
      "telefono"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "CONSUMIDOR FINAL",
        "tipoDocumento": 99,
        "nroDocumento": null,
        "condicionIva": 5,
        "razonSocial": null,
        "fechaBaja": null,
        "direccion": null,
        "idLista": null,
        "telefono": null
      }
    ]
  },
  "listas_precio": {
    "columnas": [
      "id",
      "nombre",
      "esDefault",
      "activa"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "Minorista",
        "esDefault": 1,
        "activa": 1
      }
    ]
  },
  "parametros": {
    "columnas": [
      "clave",
      "valor"
    ],
    "filas": [
      {
        "clave": "actualizado",
        "valor": "false"
      },
      {
        "clave": "avisoNvaVersion",
        "valor": "true"
      },
      {
        "clave": "backups",
        "valor": "false"
      },
      {
        "clave": "dias",
        "valor": "Lunes, Martes, Viernes"
      },
      {
        "clave": "dni",
        "valor": ""
      },
      {
        "clave": "expresion",
        "valor": ""
      },
      {
        "clave": "hora",
        "valor": "20:30"
      },
      {
        "clave": "proveedores",
        "valor": "false"
      },
      {
        "clave": "repuestos",
        "valor": "false"
      }
    ]
  },
  "parametros_facturacion": {
    "columnas": [
      "condicion",
      "puntoVta",
      "cuil",
      "razon",
      "direccion"
    ],
    "filas": [
      {
        "condicion": "monotributista",
        "puntoVta": 0,
        "cuil": 0,
        "razon": "",
        "direccion": ""
      }
    ]
  },
  "parametros_impresion": {
    "columnas": [
      "impresora",
      "papel",
      "margenIzq",
      "margenDer",
      "nomLocal",
      "desLocal",
      "dirLocal",
      "mostrarObservaciones",
      "telefonoLocal",
      "mensajeExtra",
      "textoObservaciones",
      "mostrarDireccion",
      "mostrarTelefono",
      "mostrarMensaje",
      "logo",
      "mostrarLogo",
      "mostrarNombre"
    ],
    "filas": [
      {
        "impresora": "",
        "papel": "58mm",
        "margenIzq": 0,
        "margenDer": 0,
        "nomLocal": "EASY SALES",
        "desLocal": "",
        "dirLocal": "",
        "mostrarObservaciones": 1,
        "telefonoLocal": null,
        "mensajeExtra": null,
        "textoObservaciones": "Observaciones",
        "mostrarDireccion": 1,
        "mostrarTelefono": 1,
        "mostrarMensaje": 1,
        "logo": null,
        "mostrarLogo": 1,
        "mostrarNombre": 1
      }
    ]
  },
  "productos": {
    "columnas": [
      "id",
      "codigo",
      "nombre",
      "cantidad",
      "tipoPrecio",
      "sumarIva",
      "costo",
      "precio",
      "redondeo",
      "porcentaje",
      "vencimiento",
      "faltante",
      "unidad",
      "imagen",
      "soloPrecio",
      "idCategoria",
      "fechaBaja",
      "idProveedor",
      "marca",
      "vehiculo",
      "aplicacion"
    ],
    "filas": [
      {
        "id": 1,
        "codigo": "*",
        "nombre": "VARIOS",
        "cantidad": "1.000",
        "tipoPrecio": "$",
        "sumarIva": 0,
        "costo": "1.00",
        "precio": "1.00",
        "redondeo": null,
        "porcentaje": null,
        "vencimiento": null,
        "faltante": null,
        "unidad": "UNI",
        "imagen": null,
        "soloPrecio": null,
        "idCategoria": 0,
        "fechaBaja": null,
        "idProveedor": null,
        "marca": null,
        "vehiculo": null,
        "aplicacion": null
      }
    ]
  },
  "productos_precios": {
    "columnas": [
      "id",
      "idProducto",
      "idLista",
      "tipoPrecio",
      "costo",
      "precio",
      "porcentaje",
      "redondeo",
      "sumarIva"
    ],
    "filas": [
      {
        "id": 1,
        "idProducto": 1,
        "idLista": 1,
        "tipoPrecio": "$",
        "costo": "1.00",
        "precio": "1.00",
        "porcentaje": null,
        "redondeo": 0,
        "sumarIva": 0
      }
    ]
  },
  "tipos_pago": {
    "columnas": [
      "id",
      "nombre",
      "icono",
      "color",
      "orden"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "EFECTIVO",
        "icono": "monetization_on",
        "color": "#2dc051",
        "orden": 1
      },
      {
        "id": 2,
        "nombre": "TRANSFERENCIA",
        "icono": "account_balance",
        "color": "#2db6c8",
        "orden": 2
      },
      {
        "id": 3,
        "nombre": "QR",
        "icono": "qr_code",
        "color": "#fc7b9b",
        "orden": 3
      },
      {
        "id": 4,
        "nombre": "TARJETA",
        "icono": "credit_card",
        "color": "#ee8b29",
        "orden": 4
      },
      {
        "id": 5,
        "nombre": "COMBINADO",
        "icono": "autorenew",
        "color": "#7d7d7d",
        "orden": 5
      },
      {
        "id": 6,
        "nombre": "CUENTA CORRIENTE",
        "icono": "payments",
        "color": "#6366f1",
        "orden": 6
      },
      {
        "id": 7,
        "nombre": "SALDO A FAVOR",
        "icono": "savings",
        "color": "#10b981",
        "orden": 7
      }
    ]
  },
  "usuarios": {
    "columnas": [
      "id",
      "nombre",
      "email",
      "pass",
      "idCargo"
    ],
    "filas": [
      {
        "id": 1,
        "nombre": "ADMIN",
        "email": null,
        "pass": "$2a$10$KlsaNJSyuy.58zMUqQ53x.9P3.eAW9cJXqtnE1CUKd/FwebC8z.JS",
        "idCargo": 1
      }
    ]
  }
};

const EXCLUIDAS = ['knex_migrations', 'knex_migrations_lock'];

exports.up = async function (knex) {
  const [filas] = await knex.raw(
    "SELECT TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"
  );
  const existentes = filas.map((f) => f.nombre).filter((n) => !EXCLUIDAS.includes(n));

  if (existentes.includes('ventas')) return; // instalación existente: no-op

  if (existentes.length > 0) {
    throw new Error(
      'schema_base: la base tiene ' + existentes.length + ' tabla(s) pero no tiene "ventas" (' +
      existentes.slice(0, 5).join(', ') + (existentes.length > 5 ? ', …' : '') + '). ' +
      'Es una base a medias (instalación interrumpida o manipulada): no se continúa. ' +
      'Borrar la base y reinstalar.'
    );
  }

  for (const ddl of TABLAS) {
    await knex.raw(ddl);
  }

  for (const [tabla, semilla] of Object.entries(SEMILLAS)) {
    await knex(tabla).insert(semilla.filas);
  }

  for (const ddl of FKS) {
    await knex.raw(ddl);
  }
};

exports.down = async function () {
  // No-op a propósito: una migration nunca borra el schema completo.
};
