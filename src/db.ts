import mysql from 'mysql2/promise';
import config from './conf/app.config';

let password = config.db.password;
if(config.produccion)
    if(password==="") password = "1235";

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


