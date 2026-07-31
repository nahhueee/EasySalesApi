import mysql from 'mysql2/promise';
import config from './conf/app.config';
import { AppError } from './logger/AppError';
import { CodigoError } from './logger/CodigosError';

// Fail-fast: si en producción no hay password configurada, no arrancamos con
// una credencial conocida (ver Lote 1.2, Fase 2 de seguridad). Un arranque
// caído es visible; un fallback silencioso a una password fija no lo es.
if (config.produccion && config.db.password === "") {
    throw new AppError(
        CodigoError.INTERNAL_ERROR,
        'db.password vacía en producción: no hay fallback, corregir config antes de arrancar.'
    );
}

// Configuración de la conexión a la base de datos
const conexion = {
    host: config.db.host,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    multipleStatements: false
};

// Crear una pool de conexiones
const pool = mysql.createPool(conexion);
export default pool;


