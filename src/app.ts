import express from 'express';
import morgan from 'morgan';
var cors = require('cors')

const app = express();

//setings
app.set('port', process.env.Port || 3000);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({extended: false}));
app.use(cors());


//Starting the server
app.listen(app.get('port'), () => {
  console.log('server on port ' + app.get('port'));
});

//#region RUTAS
import UsuarioRuta from './routes/usuarios_route';
app.use('/api/usuarios', UsuarioRuta);

import ProveedorRuta from './routes/proveedores_route';
app.use('/api/proveedores', ProveedorRuta);

import RubroRuta from './routes/rubros_route';
app.use('/api/rubros', RubroRuta);

import ClienteRuta from './routes/clientes_route';
app.use('/api/clientes', ClienteRuta);

import SucursalesRuta from './routes/sucursales_route';
app.use('/api/sucursales', SucursalesRuta);

import ProductosRuta from './routes/productos_route';
app.use('/api/productos', ProductosRuta);

import CargosRuta from './routes/cargos_route';
app.use('/api/cargos', CargosRuta);
//#endregion

app.use('/',(req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Servidor de EASY SALES funcionando en este puerto.');
});
