DROP DATABASE IF EXISTS dbeasysales;
CREATE DATABASE dbeasysales;

USE dbeasysales;

DROP TABLE IF EXISTS parametros;
CREATE TABLE parametros (
    clave VARCHAR(30) PRIMARY KEY,
    valor VARCHAR(50) NOT NULL DEFAULT ''
);

DROP TABLE IF EXISTS parametros_facturacion;
CREATE TABLE parametros_facturacion (
    condicion VARCHAR(50),
    puntoVta INT,
    cuil BIGINT,
    razon VARCHAR(100),
    direccion VARCHAR(250)
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
    soloPrecio BOOLEAN
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

DROP TABLE IF EXISTS ventas_entrega;
CREATE TABLE ventas_entrega (
    id INT PRIMARY KEY,
    idCliente INT NOT NULL,
    monto DECIMAL(10,2) NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
ENGINE=InnoDB;

DROP TABLE IF EXISTS ventas_entrega_detalle;
CREATE TABLE ventas_entrega_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,
    idEntrega INT NOT NULL,
    idVenta INT NOT NULL,
    montoAplicado DECIMAL(10,2) NOT NULL
)
ENGINE=InnoDB;


INSERT INTO parametros(clave, valor) 
VALUES 
('version','1.7.7'),
('dni',''), 
('expresion',''), 
('backups', 'false'), 
('dias', 'Lunes, Martes, Viernes'), 
('hora', '20:30'), 
('avisoNvaVersion', 'true'),
('actualizado', 'false');

INSERT INTO parametros_facturacion(condicion, puntoVta, cuil, razon, direccion) 
VALUES ('monotributista', 0, 0, '', '');

INSERT INTO productos(id,codigo,nombre,cantidad,tipoPrecio,costo,precio,redondeo,porcentaje,vencimiento,faltante,unidad,imagen) 
VALUES(NULL,'*','VARIOS',1,'$',1,1,NULL,NULL,NULL,NULL,'UNI',NULL);

INSERT INTO tipos_pago(id, nombre) VALUES (NULL,'EFECTIVO'), (NULL,'TARJETA'), (NULL,'TRANSFERENCIA'), (NULL,'COMBINADO');
INSERT INTO cargos(id, nombre) VALUES (NULL,'ADMINISTRADOR'), (NULL,'EMPLEADO');
INSERT INTO clientes(id, nombre) VALUES (NULL,'CONSUMIDOR FINAL');
INSERT INTO usuarios(id, nombre, email, pass, idCargo) VALUES (NULL, 'ADMIN', NULL, '1235', 1);


