// Migration: amplía usuarios_movimientos.accion de VARCHAR(100) a VARCHAR(255).
//
// Bug 2026-08-05: una venta a un cliente con nombre largo no se podía registrar.
// ventasRepository.ts:267 arma "Nueva entrada de venta para el cliente " (40 chars)
// + cliente.nombre (hasta 100 chars permitidos por clientes.nombre). El INSERT en
// usuarios_movimientos fallaba con "Data too long for column 'accion'" DENTRO de la
// transacción de la venta → rollback completo, la venta no se guardaba.
//
// El mismo patrón (prefijo fijo + campo de negocio sin acotar) se repite en otros
// ~6 call sites de SesionServ.RegistrarMovimiento (clientes, usuarios, proveedores,
// registros). 255 cubre el prefijo más largo actual + nombre/descripción de 100
// con margen. El código además trunca defensivamente en UsuariosRepo.RegistrarMovimiento
// (ver usuariosRepository.ts) como segunda capa — la ampliación reduce la chance
// real de que eso llegue a pasar.

exports.up = async function (knex) {
  await knex.schema.alterTable('usuarios_movimientos', table => {
    table.string('accion', 255).alter();
  });
};

exports.down = async function (knex) {
  // Revertir el tamaño de columna: si hay filas con accion > 100 chars (algo que
  // este mismo fix debería evitar de acá en más, pero pudo haber pasado antes con
  // el truncado defensivo), el down falla — comportamiento esperado, no truncamos
  // datos existentes silenciosamente.
  await knex.schema.alterTable('usuarios_movimientos', table => {
    table.string('accion', 100).alter();
  });
};
