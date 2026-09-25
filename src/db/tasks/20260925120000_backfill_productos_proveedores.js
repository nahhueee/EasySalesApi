// Migration: segundo backfill de productos_proveedores.
//
// La migración 20260908120000_productos_proveedores.js hizo el backfill UNA vez, sobre los
// productos que existían ese día. Pero productosRepository.Agregar/Modificar escribían sólo el
// espejo productos.idProveedor y nunca creaban la fila en la tabla nueva, así que todo producto
// creado o editado después quedó huérfano: espejo cargado, tabla vacía. En la base del cliente
// eran 226 productos -- el tab "Proveedores" del modal les salía vacío, y el matcheo por código
// de proveedor de la importación de precios no los encontraba nunca.
//
// El origen del bug se corrige en el mismo release (SincronizarProveedorPrincipal, llamada desde
// Agregar y Modificar). Esta migración repara lo que ya está roto; sin ella el arreglo sólo
// serviría para los productos nuevos.
//
// Idempotente: el NOT EXISTS hace que correrla de nuevo no inserte nada. Se puede volver a
// ejecutar sin riesgo si aparecen más huérfanos.
//
// esPrincipal = 1: por definición el proveedor del espejo ES el principal, y estos productos no
// tienen ninguna otra fila en la tabla (si la tuvieran, no serían huérfanos). costo y
// codigoProveedor quedan NULL: no hay forma de saber a qué proveedor correspondía el costo del
// producto, y inventarlo sería peor que dejarlo vacío -- lo completa el tab o la importación de
// precios. Se excluyen productos dados de baja lógica.

exports.up = async function (knex) {
  const existeTabla = await knex.schema.hasTable('productos_proveedores');
  if (!existeTabla) return;

  await knex.raw(`
    INSERT INTO productos_proveedores (idProducto, idProveedor, codigoProveedor, costo, esPrincipal, fechaActualizacion)
    SELECT p.id, p.idProveedor, NULL, NULL, 1, NOW()
    FROM productos p
    WHERE p.idProveedor IS NOT NULL
      AND p.fechaBaja IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM productos_proveedores pp WHERE pp.idProducto = p.id
      )
  `);
};

exports.down = async function () {
  // No hay down: las filas insertadas acá son indistinguibles de las que creó el backfill
  // original o el usuario desde el tab. Borrarlas por fecha o por "costo IS NULL" se llevaría
  // puestas relaciones legítimas. Revertir el código no necesita revertir estos datos -- la
  // relación es correcta, sólo faltaba.
};
