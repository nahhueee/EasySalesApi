import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';

const http = require('http');
const path = require('path');
const socketIo = require('socket.io');

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
export { io };

io.on('connection', (socket) => {
    console.log('SocketIo: Nuevo cliente conectado');
  
    socket.on('disconnect', () => {
      console.log('SocketIo: Cliente desconectado');
    });
});

//Starting the server
server.listen(app.get('port'), () => {
    console.log('server ' + process.env.NODE_ENV + ' on port ' + app.get('port'));
});

//#region Rutas
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


//AdminServer Route
import adminServerRuta from './routes/adminRoute';
app.use('/easysales/adminserver', adminServerRuta);

//Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use('/easysales/imagenes', imagenesRuta);

//Print docs Route
import pdfRoute from './routes/pdfRoute';
app.use('/easysales/docs', pdfRoute);

//Facturacion Route
import facturacionRuta from './routes/facturacionRoute';
app.use('/easysales/facturacion', facturacionRuta);

//#region backups y contenidos de pago
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
  

