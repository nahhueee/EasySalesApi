import mysql from 'mysql2/promise';
import config from './conf/app.config';

//const password = config.produccion ? config.db.password : "";
const password = config.db.password;

// Configuración de la conexión a la base de datos
const conexion = {
    host: config.db.host,
    user: config.db.user,
    password: password,
    database: config.db.database,
    multipleStatements: true
};

// Crear una pool de conexiones
const pool = mysql.createPool(conexion);
export default pool;


