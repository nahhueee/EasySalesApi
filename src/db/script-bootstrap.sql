-- Variante NO destructiva de script.sql, para usar exclusivamente desde el instalador
-- de "Easy Sales Servidor" (Custom Action de SQL Databases en Advanced Installer).
--
-- Diferencia con script.sql: se sacaron el DROP DATABASE IF EXISTS y todos los
-- DROP TABLE IF EXISTS que precedían a cada CREATE TABLE.
--
-- Por qué: Advanced Installer ya crea la base con "Create database if it does not
-- exist" (gate propio), pero eso NO protege contra lo que hay escrito adentro del
-- script — si este script tuviera los DROP, se ejecutarían igual sin importar ese
-- checkbox. Sin los DROP, en el peor caso (que el gate de "¿ya existe la base?"
-- falle y esto corra igual contra una base con datos) un CREATE TABLE sobre una
-- tabla que ya existe tira error visible en vez de borrar todo en silencio.
--
-- No es un reemplazo de script.sql para otros usos (reset de entorno de dev, etc.) —
-- ese sigue intacto. Este archivo es solo para el bootstrap inicial de una sucursal.

USE dbeasysales;



CREATE TABLE parametros_facturacion (
    condicion VARCHAR(50),
    puntoVta INT,
    cuil BIGINT,
    razon VARCHAR(100),
    direccion VARCHAR(250)
);

CREATE TABLE parametros_impresion (
    impresora VARCHAR(100),
    papel VARCHAR(10),
    margenIzq INT DEFAULT 0,
    margenDer INT DEFAULT 0,
    nomLocal VARCHAR(100),
    desLocal VARCHAR(100),
    dirLocal VARCHAR(150)
);

CREATE TABLE backups (
    nombre VARCHAR(30) PRIMARY KEY,
    fecha DATE
);

CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    email VARCHAR(100),
    pass VARCHAR(30),
    idCargo INT
);

CREATE TABLE usuarios_movimientos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fecha DATETIME,
    idUsuario INT,
    accion VARCHAR(100)
);

CREATE TABLE cargos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

CREATE TABLE clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

CREATE TABLE registros (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(80),
    prioridad INT,
    total DECIMAL(10,2)
)
ENGINE=InnoDB;

CREATE TABLE registros_detalle (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idRegistro INT,
    accion VARCHAR(6),
    monto DECIMAL(10,2),
    observacion VARCHAR(80),
    fecha DATE
)
ENGINE=InnoDB;


CREATE TABLE productos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30),
    nombre VARCHAR(100),
    cantidad DECIMAL(10,2),
    tipoPrecio VARCHAR(2),
    sumarIva INT DEFAULT 0,
    costo DECIMAL(10,2),
    precio DECIMAL(10,2),
    redondeo INT,
    porcentaje DECIMAL(6,2),
    vencimiento DATE NULL,
    faltante INT,
    unidad VARCHAR(3),
    imagen VARCHAR(250),
    soloPrecio BOOLEAN,
    idCategoria INT DEFAULT 0
);


CREATE TABLE cajas (
    id INT PRIMARY KEY,
    idResponsable INT,
    fecha DATE,
    hora VARCHAR(5),
    fechaBaja DATE,
    inicial DECIMAL(10,2),
    ventas DECIMAL(10,2),
    entradas DECIMAL(10,2),
    salidas DECIMAL(10,2),
    finalizada BOOLEAN
)
ENGINE=InnoDB;

CREATE TABLE cajas_movimientos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCaja INT,
    tipoMovimiento VARCHAR(10),
    monto DECIMAL(10,2),
    descripcion VARCHAR(150)
);

CREATE TABLE ventas (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCaja INT,
    idCliente INT,
    fecha DATE,
    hora VARCHAR(5),
    fechaBaja DATE,
    obsBaja VARCHAR(200)
)
ENGINE=InnoDB;

CREATE TABLE ventas_detalle (
    id INT UNSIGNED AUTO_INCREMENT,
    idVenta INT,
    idProducto INT,
    nomProd VARCHAR(100),
    cantidad DECIMAL(10,2),
    costo DECIMAL(10,2),
    precio DECIMAL(10,2),

    PRIMARY KEY(id,idVenta)
)
ENGINE=InnoDB;

CREATE TABLE ventas_factura (
    idVenta INT PRIMARY KEY,
    cae BIGINT,
    caeVto DATE,
    ticket INT,
    tipoFactura INT,
    neto DECIMAL(10,2),
    iva DECIMAL(10,2),
    dni BIGINT,
    tipoDni INT,
    ptoVenta INT,
    condReceptor INT DEFAULT 0
)
ENGINE=InnoDB;

CREATE TABLE ventas_pago (
    idVenta INT PRIMARY KEY,
    descuento DECIMAL(10,2),
    recargo DECIMAL(10,2),
    entrega DECIMAL(10,2),
    monto DECIMAL(10,2) DEFAULT 0,
    tipoModificador ENUM('porcentaje','monto') NULL,
    realizado BOOLEAN
)
ENGINE=InnoDB;

CREATE TABLE ventas_entrega (
    id INT PRIMARY KEY,
    idCliente INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
ENGINE=InnoDB;

CREATE TABLE ventas_entrega_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idEntrega INT NOT NULL,
    idVenta INT NOT NULL,
    montoAplicado DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;

CREATE TABLE ventas_pagos_detalle (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idVenta INT NOT NULL,
    idTPago INT NOT NULL,
    idEntrega INT,
    monto DECIMAL(10,2) NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE etiquetas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    descripcion VARCHAR(50),
    tamanio VARCHAR(15),
    titulo VARCHAR(50),
    mOferta INT,
    mCodigo INT,
    mPrecio INT,
    mNombre INT,
    mVencimiento INT,
    bordeColor VARCHAR(10),
    bordeAncho VARCHAR(10),
    tituloColor VARCHAR(10),
    tituloAlineacion VARCHAR(10),
    ofertaFondo VARCHAR(10),
    ofertaAlineacion VARCHAR(10),
    nombreAlineacion VARCHAR(10),
    vencimientoAlineacion VARCHAR(10),
    precioAlineacion VARCHAR(10),
    precioColor VARCHAR(10)
);

CREATE TABLE tipos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(15),
    icono VARCHAR(15),
    color VARCHAR(15),
    orden INT
);
INSERT INTO tipos_pago(nombre, icono, color, orden)
VALUES
('EFECTIVO', 'monetization_on', '#2dc051', 1),
('TRANSFERENCIA', 'account_balance', '#2db6c8', 2),
('QR', 'qr_code', '#fc7b9b', 3),
('TARJETA', 'credit_card', '#ee8b29', 4),
('COMBINADO', 'autorenew', '#7d7d7d', 5);


CREATE TABLE parametros (
    clave VARCHAR(30) PRIMARY KEY,
    valor VARCHAR(50) NOT NULL DEFAULT ''
);
INSERT INTO parametros(clave, valor)
VALUES
('dni',''),
('expresion',''),
('backups', 'false'),
('dias', 'Lunes, Martes, Viernes'),
('hora', '20:30'),
('avisoNvaVersion', 'true'),
('actualizado', 'false');

INSERT INTO parametros_facturacion(condicion, puntoVta, cuil, razon, direccion)
VALUES ('monotributista', 0, 0, '', '');

INSERT INTO parametros_impresion(impresora, papel, margenIzq, margenDer, nomLocal, desLocal, dirLocal)
VALUES ('', '58mm', 0, 0, 'EASY SALES', '', '');

INSERT INTO productos(id,codigo,nombre,cantidad,tipoPrecio,costo,precio,redondeo,porcentaje,vencimiento,faltante,unidad,imagen)
VALUES(NULL,'*','VARIOS',1,'$',1,1,NULL,NULL,NULL,NULL,'UNI',NULL);

INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'ENCARGADO'), (NULL,'EMPLEADO');
INSERT INTO clientes(id, nombre) VALUES (NULL,'CONSUMIDOR FINAL');
INSERT INTO usuarios(id, nombre, email, pass, idCargo) VALUES (NULL, 'ADMIN', NULL, '1235', 1);
