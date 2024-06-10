import mysql from 'mysql2/promise';
import config from './conf/app.config';

// Configuración de la conexión a la base de datos
const conexion = {
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: true
};

// Crear una pool de conexiones
const pool = mysql.createPool(conexion);
export default pool;


