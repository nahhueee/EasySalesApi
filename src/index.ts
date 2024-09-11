import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';
const path = require('path');

const app = express();

//setings
app.set('port', process.env.Port || config.port);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cors());
app.use(express.static(path.join(__dirname, 'upload')));

//Starting the server
app.listen(app.get('port'), () => {
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

app.use('/easysales/usuarios', usuariosRuta);
app.use('/easysales/clientes', clientesRuta);
app.use('/easysales/rubros', rubrosRuta);
app.use('/easysales/productos', productosRuta);
app.use('/easysales/ventas', ventasRuta);
app.use('/easysales/movimientos', movimientosRuta);
app.use('/easysales/cajas', cajasRuta);
app.use('/easysales/estadisticas', estadisticasRuta);
//#endregion

//Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use('/easysales/imagenes', imagenesRuta);

//Print docs Route
import pdfRoute from './routes/pdfRoute';
app.use('/easysales/docs', pdfRoute);

//Version del sistema Route
app.get('/easysales/version',(_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).json('1.0.0');
});

//Index Route
app.get('/easysales', (req, res) => {
    res.status(200).send('Servidor de EasySales funcionando en este puerto.');
});

//404
app.use((_req, res) => {
    res.status(404).send('No se encontró el recurso solicitado.');
});
  

