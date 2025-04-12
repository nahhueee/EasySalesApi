DROP DATABASE IF EXISTS dbeasysales;
CREATE DATABASE dbeasysales;

USE dbeasysales;

DROP TABLE IF EXISTS parametros;
CREATE TABLE parametros (
    clave VARCHAR(15) PRIMARY KEY,
    valor VARCHAR(30) NOT NULL DEFAULT ''
);

DROP TABLE IF EXISTS backups;
CREATE TABLE backups (
    nombre VARCHAR(30) PRIMARY KEY,
    fecha DATE
);

DROP TABLE IF EXISTS usuarios;
CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100),
    email VARCHAR(100),
    pass VARCHAR(30),
    idCargo INT
);

DROP TABLE IF EXISTS cargos;
CREATE TABLE cargos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

DROP TABLE IF EXISTS clientes;
CREATE TABLE clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

DROP TABLE IF EXISTS categorias;
CREATE TABLE categorias (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100)
);

DROP TABLE IF EXISTS tipos_pago;
CREATE TABLE tipos_pago (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(15)
);

DROP TABLE IF EXISTS productos;
CREATE TABLE productos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(30),
    nombre VARCHAR(100),
    cantidad DECIMAL(10,2),
    tipoPrecio VARCHAR(2),
    costo DECIMAL(10,2),
    precio DECIMAL(10,2),
    redondeo INT,
    porcentaje DECIMAL(6,2),
    vencimiento DATE,
    faltante INT,
    unidad VARCHAR(3),
    imagen VARCHAR(250),
    idCategoria INT
);

DROP TABLE IF EXISTS cajas;
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

DROP TABLE IF EXISTS cajas_movimientos;
CREATE TABLE cajas_movimientos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    idCaja INT,
    tipoMovimiento VARCHAR(10),
    monto DECIMAL(10,2),
    descripcion VARCHAR(150)
);

DROP TABLE IF EXISTS ventas;
CREATE TABLE ventas (
    id INT,
    idCaja INT,
    idCliente INT,
    fecha DATE,
    hora VARCHAR(5),

    PRIMARY KEY(id,idCaja)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_detalle;
CREATE TABLE ventas_detalle (
    id INT UNSIGNED AUTO_INCREMENT,
    idVenta INT,
    idProducto INT,
    cantidad DECIMAL(10,2),
    costo DECIMAL(10,2),
    precio DECIMAL(10,2),
    
    PRIMARY KEY(id,idVenta)
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_factura;
CREATE TABLE ventas_factura (
    idVenta INT PRIMARY KEY,
    cae VARCHAR(80),
    caeVto DATE,
    ticket INT,
    tipoFactura INT,
    dni BIGINT,
    tipoDni INT,
    efectivo DECIMAL(10,2),
    impreso BOOLEAN
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_pago;
CREATE TABLE ventas_pago (
    idVenta INT PRIMARY KEY,
    idPago INT,
    efectivo DECIMAL(10,2),
    digital DECIMAL(10,2),
    descuento DECIMAL(4,2),
    recargo DECIMAL(4,2),
    entrega DECIMAL(10,2),
    realizado BOOLEAN
)
ENGINE=InnoDB;


INSERT INTO parametros(clave, valor) 
VALUES 
('version','1.5.0'),
('dni',''), 
('expresion',''), 
('backups', 'false'), 
('dias', 'Lunes, Martes, Viernes'), 
('hora', '20:30'), 
('avisoNvaVersion', 'true'),
('actualizado', 'true');

INSERT INTO productos(id,codigo,nombre,cantidad,tipoPrecio,costo,precio,redondeo,porcentaje,vencimiento,faltante,unidad,imagen,idCategoria) 
VALUES(NULL,'*','VARIOS',1,'$',1,1,NULL,NULL,NULL,NULL,'UNI',NULL,NULL);

INSERT INTO tipos_pago(id, nombre) VALUES (NULL,'EFECTIVO'), (NULL,'TARJETA'), (NULL,'TRANSFERENCIA'), (NULL,'COMBINADO');
INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'EMPLEADO');
INSERT INTO clientes(id, nombre) VALUES (NULL,'CONSUMIDOR FINAL');
INSERT INTO usuarios(id, nombre, email, pass, idCargo) VALUES (NULL, 'ADMIN', NULL, '1235', 1);
