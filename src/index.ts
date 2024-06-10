import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import config from './conf/app.config';

const app = express();

//setings
app.set('port', process.env.Port || config.port);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cors());

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

app.use('/api/usuarios', usuariosRuta);
app.use('/api/clientes', clientesRuta);
app.use('/api/rubros', rubrosRuta);
app.use('/api/productos', productosRuta);
app.use('/api/ventas', ventasRuta);
app.use('/api/movimientos', movimientosRuta);
app.use('/api/cajas', cajasRuta);
app.use('/api/estadisticas', estadisticasRuta);
//#endregion

//Upload images Route
import imagenesRuta from './routes/imagenesRoute';
app.use('/api/imagenes', imagenesRuta);

//Index Route
app.get('/',(_req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Servidor de EasySales funcionando en este puerto.');
});

//404
app.use((_req, res) => {
    res.status(400).json({ error: 'Ruta no encontrada' });
});
  

