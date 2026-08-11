// Migration NO-OP / auto-corrección: esta migración originalmente creaba un parámetro global
// `topePagoProveedorEmpleado`. Se descartó el mismo día (2026-08-10): el tope real no es un
// valor único del comercio, es el fondo de proveedores QUE YA SE DEFINE POR CAJA
// (`cajas.fondoProveedores`, PR5). El tope para un EMPLEADO es el disponible de esa caja
// puntual (fondoProveedores − pagos ya hechos con cargo a ella), no un número fijo global.
//
// El `up` original de este archivo no llegó a correr en ningún ambiente antes de la
// corrección (mismo día, misma sesión). Se deja como no-op idempotente que además limpia el
// parámetro si alguien llegó a correrlo, en vez de eliminar el archivo (el sandbox de trabajo
// no pudo borrarlo por un bloqueo de OneDrive — mismo patrón que otras veces).
//
// La lógica real vive en ProveedorCuentaRepo.ObtenerDisponibleFondo + utils/permisos.ts
// (PuedeRegistrarPagoProveedor), sin parámetro ni migración nueva.

exports.up = async function (knex) {
  await knex('parametros').where({ clave: 'topePagoProveedorEmpleado' }).del();
};

exports.down = async function (knex) {
  // No-op a propósito: no hay nada que revertir.
};
