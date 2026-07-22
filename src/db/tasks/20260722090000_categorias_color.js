/**
 * Migration: tabla categorias + color
 * La tabla `categorias` nunca tuvo una migracion propia en el repo (el ABM en
 * rubrosRepository.ts ya existia, pero corria contra una tabla creada a mano en algun
 * momento fuera de control de versiones). La creamos aca de forma idempotente para que
 * cualquier entorno nuevo (o que nunca la tuvo) quede consistente, y de paso sumamos
 * color (hex #RRGGBB) como campo opcional, para identificar la categoria visualmente en
 * el ABM y pintar sus series en los reportes de estadisticas.
 */

exports.up = async function (knex) {
  const existeTabla = await knex.schema.hasTable('categorias');

  if (!existeTabla) {
    await knex.schema.createTable('categorias', table => {
      table.increments('id').primary();
      table.string('nombre', 100).notNullable();
      table.string('color', 7).nullable();
    });

    // El resto del ABM (rubrosRepository.ts: Obtener, RubrosSelector) excluye por convención
    // el id=1 tratándolo como fila de sistema. En una tabla recién creada el AUTO_INCREMENT
    // arranca en 1, así que sin este seed la primera categoría real que se cargue queda con
    // id=1 y desaparece de todos los listados. Reservamos la fila para que el próximo insert
    // real empiece en id=2.
    await knex('categorias').insert({ id: 1, nombre: 'SIN CATEGORIZAR' });

    return; // La tabla ya nace con la columna color, no hace falta el ALTER de abajo
  }

  const hasColor = await knex.schema.hasColumn('categorias', 'color');
  if (!hasColor) {
    await knex.schema.alterTable('categorias', table => {
      table.string('color', 7).nullable();
    });
  }
};

exports.down = async function (knex) {
  const hasColor = await knex.schema.hasColumn('categorias', 'color');
  if (hasColor) {
    await knex.schema.alterTable('categorias', table => {
      table.dropColumn('color');
    });
  }
};
