// scripts/test/seed-test.js
//
// Seed FIJO de la base de test. Corre después de las migrations (que ya dejan las semillas base:
// CONSUMIDOR FINAL id=1, ADMIN id=1, cargos 1/2/3, lista Minorista id=1, VARIOS id=1, tipos_pago 1..8
// con EFECTIVO=1 y SEÑA=8).
//
// Ids fijos: los tests los importan desde test/helpers/ids.ts (mantener los dos archivos alineados).
// Sin datos aleatorios ni fechas fijas: las fechas son CURDATE() para que la caja sea "de hoy".

const bcrypt = require('bcryptjs');

const IDS = {
  usuarioAdmin: 2,        // TEST ADMIN (ADMINISTRADOR) — el usuario de prueba
  usuarioEmpleado: 3,     // TEST EMPLEADO (EMPLEADO)
  listaMayorista: 2,
  productoSimple: 10,     // precio 100, costo 60, stock 50
  productoMultiprecio: 11, // Minorista 200 / Mayorista 150, costo 90, stock 20
  clienteConSaldo: 2,     // debe 5000 en cuenta corriente (apertura)
  clienteSinSaldo: 3,
  cajaAbierta: 1,         // inicial 10000, abierta hoy
  cajaCerrada: 2,         // finalizada
};
const PASS_TEST = 'test1234';

exports.IDS = IDS;
exports.PASS_TEST = PASS_TEST;

exports.seed = async function (knex) {
  const hash = bcrypt.hashSync(PASS_TEST, 10);

  await knex('usuarios').insert([
    { id: IDS.usuarioAdmin, nombre: 'TEST ADMIN', email: null, pass: hash, idCargo: 1 },
    { id: IDS.usuarioEmpleado, nombre: 'TEST EMPLEADO', email: null, pass: hash, idCargo: 3 },
  ]);

  await knex('listas_precio').insert({ id: IDS.listaMayorista, nombre: 'Mayorista', esDefault: 0, activa: 1 });

  const producto = (id, codigo, nombre, cantidad, costo, precio) => ({
    id, codigo, nombre, cantidad, tipoPrecio: '$', sumarIva: 0, costo, precio, redondeo: 0,
    porcentaje: null, vencimiento: null, faltante: 0, unidad: 'UNI', imagen: null, soloPrecio: 0,
    idCategoria: 1, fechaBaja: null, idProveedor: null,
  });
  await knex('productos').insert([
    producto(IDS.productoSimple, 'T-SIMPLE', 'PRODUCTO TEST SIMPLE', 50, 60, 100),
    producto(IDS.productoMultiprecio, 'T-MULTI', 'PRODUCTO TEST MULTIPRECIO', 20, 90, 200),
  ]);
  await knex('productos_precios').insert([
    { idProducto: IDS.productoSimple, idLista: 1, tipoPrecio: '$', costo: 60, precio: 100, porcentaje: null, redondeo: 0, sumarIva: 0 },
    { idProducto: IDS.productoMultiprecio, idLista: 1, tipoPrecio: '$', costo: 90, precio: 200, porcentaje: null, redondeo: 0, sumarIva: 0 },
    { idProducto: IDS.productoMultiprecio, idLista: IDS.listaMayorista, tipoPrecio: '$', costo: 90, precio: 150, porcentaje: null, redondeo: 0, sumarIva: 0 },
  ]);

  await knex('clientes').insert([
    { id: IDS.clienteConSaldo, nombre: 'CLIENTE TEST CON SALDO', tipoDocumento: 96, nroDocumento: 30111222, condicionIva: 5, telefono: '1155550001' },
    { id: IDS.clienteSinSaldo, nombre: 'CLIENTE TEST SIN SALDO', tipoDocumento: 96, nroDocumento: 30333444, condicionIva: 5, telefono: '1155550002' },
  ]);
  // Convención del ledger: saldo > 0 = el cliente debe; saldo < 0 = saldo a favor.
  await knex('cuenta_corriente_movimientos').insert({
    idCliente: IDS.clienteConSaldo, fecha: knex.raw('CURDATE()'), hora: '09:00', tipo: 'apertura',
    descripcion: 'Saldo inicial (seed test)', debe: 5000, haber: 0, idReferencia: null, saldo: 5000,
  });

  await knex('cajas').insert([
    { id: IDS.cajaAbierta, idResponsable: IDS.usuarioAdmin, fecha: knex.raw('CURDATE()'), hora: '08:00',
      inicial: 10000, ventas: 0, entradas: 0, salidas: 0, finalizada: 0, fondoProveedores: null },
    { id: IDS.cajaCerrada, idResponsable: IDS.usuarioAdmin, fecha: knex.raw('CURDATE() - INTERVAL 1 DAY'), hora: '08:00',
      inicial: 5000, ventas: 0, entradas: 0, salidas: 0, finalizada: 1, fondoProveedores: null },
  ]);

  await knex('parametros').where({ clave: 'pedidos' }).update({ valor: 'true' });
};
