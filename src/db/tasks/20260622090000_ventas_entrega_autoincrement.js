exports.up = async function (knex) {
  // 1. Convertir id de PK manual (generado por la app) a AUTO_INCREMENT.
  //    MODIFY es seguro de reejecutar: si ya es AUTO_INCREMENT, no cambia nada.
  await knex.raw('ALTER TABLE ventas_entrega MODIFY id INT NOT NULL AUTO_INCREMENT');

  // 2. Fijar el contador en MAX(id)+1 para no colisionar con los ids ya insertados a mano.
  const ultimo = await knex('ventas_entrega').max('id as maxId').first();
  const proximoId = (ultimo && ultimo.maxId ? ultimo.maxId : 0) + 1;
  await knex.raw(`ALTER TABLE ventas_entrega AUTO_INCREMENT = ${proximoId}`);
};

exports.down = async function (knex) {
  // Revertir a PK manual (sin AUTO_INCREMENT)
  await knex.raw('ALTER TABLE ventas_entrega MODIFY id INT NOT NULL');
};
