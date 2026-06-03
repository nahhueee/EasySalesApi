import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';
import pkg from '../package.json';
import { DescargarActualizacion } from '../updater/config/DescargarActualizacion';
import { CheckearActualizacion } from '../updater/config/CheckearActualizacion';
import { logger } from './logger/logger';
import { CodigoError } from './logger/CodigosError';

// Captura de errores no controlados.
// Garantiza que promesas rechazadas sin .catch() y excepciones síncronas
// fuera de Express queden logueadas (y lleguen a AdminServer vía ErrorBatchTransport).
process.on('unhandledRejection', (reason: unknown) => {
    logger.error({
        code:    CodigoError.INTERNAL_ERROR,
        message: reason instanceof Error ? reason.message : String(reason),
        type:    'UNHANDLED_REJECTION',
        stack:   reason instanceof Error ? reason.stack : undefined,
    });
});

process.on('uncaughtException', (err: Error) => {
    logger.error({
        code:    CodigoError.INTERNAL_ERROR,
        message: err.message,
        type:    'UNCAUGHT_EXCEPTION',
        stack:   err.stack,
    });
});

const http = require('http');
const path = require('path');
const fs = require('fs');

const socketIo = require('socket.io');
const app = express();
const server = http.createServer(app);

//setings
app.set('port', process.env.Port || config.port);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cors());
app.use(express.static(path.join(__dirname, 'upload')));

if(!config.produccion){
    app.use(morgan("dev"));
}else{
    app.use(
        morgan("combined", {
        skip: (req, res) => res.statusCode < 400
        })
  );
}

//setings SocketIo
const io = socketIo(server, {
    cors: {
      origin: "*", 
      methods: ["GET", "POST", "PUT", "DELETE"],
    },
});

//Starting the server
let host:string = "127.0.0.1";
if(config.esServer){
    host = "0.0.0.0";
}

server.listen(app.get('port'), host, () => {
    console.log('server ' + process.env.NODE_ENV + ' en puerto ' + app.get('port'));
});

//#region Rutas
import actualizacionRuta from './routes/actualizacionRoute';
import backupRoute from './routes/backupRoute';
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
import cuentasRuta from './routes/cuentasCorsRoute';
import etiquetasRuta from './routes/etiquetasRoute';
import registrosRuta from './routes/registrosRoute';

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
app.use('/easysales/cuentas', cuentasRuta);
app.use('/easysales/etiquetas', etiquetasRuta);
app.use('/easysales/registros', registrosRuta);
app.use('/easysales/backup', backupRoute);

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

import { ServidorServ } from './services/servidorService';
import { errorMiddleware } from './middlewares/errorMiddleware';
import { BackupsServ } from './services/backupService';
import { HeartbeatServ } from './services/heartbeatService';
import { ErrorBatchServ } from './services/errorBatchService';

if(!config.web){
}

// Heartbeat y batch de errores: corren en toda instancia con terminal.json presente
if(!config.web){
    HeartbeatServ.IniciarCron();
    ErrorBatchServ.IniciarCron();
    BackupsServ.IniciarCron();

    ServidorServ.IniciarModoServidor();
}


//Index Route
app.get('/easysales', (req, res) => {
    res.status(200).send('Servidor de EasySales funcionando en este puerto. En la versión ' + pkg.version + '');
});
 

//Mantenimiento
app.get('/easysales/status', (req, res) => {
    res.status(200).send('Servidor de En Linea');
});
app.get('/easysales/version', (req, res) =>{
    return res.json({
        version: pkg.version
    });
});
// Expone el terminal_id al frontend para el gate de canary y telemetría.
// Devuelve { terminal: string } si terminal.json existe y está bien formado, o 404 si no hay terminal.
app.get('/easysales/terminal', (req, res) => {
    const TERMINAL_FILE = path.join(__dirname, '..', 'terminal.json');
    if (!fs.existsSync(TERMINAL_FILE)) {
        return res.status(404).json({ terminal: null });
    }
    try {
        const data = JSON.parse(fs.readFileSync(TERMINAL_FILE, 'utf-8'));
        if (!data.terminal) return res.status(404).json({ terminal: null });
        return res.json({ terminal: data.terminal });
    } catch {
        return res.status(404).json({ terminal: null });
    }
});

app.get('/easysales/pendiente', (req, res) =>{
    const PENDING_FILE = path.join(__dirname, '..', 'updater', 'pendiente.json');
    const existe = fs.existsSync(PENDING_FILE);

    return res.json({
        pendiente: existe
    });
});
app.get('/easysales/forzar-descarga', async (req, res) => {
  try {
    const info = await CheckearActualizacion();
    if (info.desactualizado) {
      await DescargarActualizacion(info);
      console.log("Se descargo la actualizacion")
    }

    return res.status(200).json("OK");

  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Error al forzar descarga'
    });
  }
});

 
//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});

//Manejo y logs de errores
app.use(errorMiddleware);

