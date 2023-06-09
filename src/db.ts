import mysql from 'mysql';

var pool  = mysql.createPool({
    host: '127.0.0.1',
    user: 'root',
    password: "",
    database: 'easysalesapp',
    multipleStatements: true
});

module.exports.pool = pool;

