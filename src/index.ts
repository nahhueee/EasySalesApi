import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';
const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

const socketIo = require('socket.io');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);

//setings
app.set('port', process.env.Port || config.port);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cors());
app.use(express.static(path.join(__dirname, 'upload')));

//setings SocketIo
const io = socketIo(server, {
    cors: {
      origin: "*", 
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
});

// Exportartamos io para usarlo en otros módulos
// export { io };

// io.on('connection', (socket) => {
//     console.log('SocketIo: Nuevo cliente conectado');
  
//     socket.on('disconnect', () => {
//       console.log('SocketIo: Cliente desconectado');
//     });
// });

//Starting the server
if(config.produccion){
    let options;

    //Si la maquina va a actuar de servidor proveemos ssl de la ip que va a proveer a las terminales
    if(config.esServer){
        options = {
            key: fs.readFileSync(path.join(__dirname, '../ssl/server/key.pem')),
            cert: fs.readFileSync(path.join(__dirname, '../ssl/server/cert.pem'))
        };
    }else{ //Si no es servidor, solo se va a usar en una maquina, usamos ssl de 127.0.0.1
        options = {
            key: fs.readFileSync(path.join(__dirname, '../ssl/local/key.pem')),
            cert: fs.readFileSync(path.join(__dirname, '../ssl/local/cert.pem'))
        };
    }
      
    https.createServer(options, app).listen(app.get('port'), () => {
    console.log('server HTTPS productivo ' + process.env.NODE_ENV + ' en puerto ' + app.get('port'));
    });
}else{
    server.listen(app.get('port'),() => {
        console.log('server desarrollo ' + process.env.NODE_ENV + ' en puerto ' + app.get('port'));
    });
}

//#region Rutas
import actualizacionRuta from './routes/actualizacionRoute';
import usuariosRuta from './routes/usuariosRoute';
import clientesRuta from './routes/clientesRoute';
import rubrosRuta from './routes/rubrosRoute';
import productosRuta from './routes/productosRoute';
import ventasRuta from './routes/ventasRoute';
import movimientosRuta from './routes/movimientosRoute';
import cajasRuta from './routes/cajasRoute';
import estadisticasRuta from './routes/estadisticasRoute';
import parametrosRuta from './routes/parametrosRoute';
import logsRuta from './routes/logsRoute';
import servidorRuta from './routes/servidorRoute';

app.use('/easysales/update', actualizacionRuta)
app.use('/easysales/usuarios', usuariosRuta);
app.use('/easysales/clientes', clientesRuta);
app.use('/easysales/rubros', rubrosRuta);
app.use('/easysales/productos', productosRuta);
app.use('/easysales/ventas', ventasRuta);
app.use('/easysales/movimientos', movimientosRuta);
app.use('/easysales/cajas', cajasRuta); 
app.use('/easysales/estadisticas', estadisticasRuta);
app.use('/easysales/parametros', parametrosRuta);
app.use('/easysales/logs', logsRuta);
app.use('/easysales/server', servidorRuta);


//AdminServer Route
import adminServerRuta from './routes/adminRoute';
app.use('/easysales/adminserver', adminServerRuta);

//Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use('/easysales/imagenes', imagenesRuta);

//Files Route
import filesRoute from './routes/filesRoute';
app.use('/easysales/files', filesRoute);
//#endregion

//#region backups 
import backupRoute from './routes/backupRoute';
app.use('/easysales/backup', backupRoute);

import {BackupsServ} from './services/backupService';
BackupsServ.IniciarCron();
//#endregion

//Index Route
app.get('/easysales', (req, res) => {
    res.status(200).send('Servidor de EasySales funcionando en este puerto.');
});
 
//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});
  

