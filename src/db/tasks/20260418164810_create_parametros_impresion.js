/**
 * @param {import('knex')} knex
 */
exports.up = async function (knex) {
  const exists = await knex.schema.hasTable('parametros_impresion');

  if (!exists) {
    await knex.schema.createTable('parametros_impresion', (table) => {
      table.string('impresora', 100);
      table.string('papel', 10);
      table.integer('margenIzq').defaultTo(0);
      table.integer('margenDer').defaultTo(0);
      table.string('nomLocal', 100);
      table.string('desLocal', 100);
      table.string('dirLocal', 150);
    });
  }

  // Evita duplicados (idempotencia en insert)
  const existeRegistro = await knex('parametros_impresion')
    .where({
      impresora: '',
      papel: '58mm',
      nomLocal: 'EASY SALES'
    })
    .first();

  if (!existeRegistro) {
    await knex('parametros_impresion').insert({
      impresora: '',
      papel: '58mm',
      margenIzq: 0,
      margenDer: 0,
      nomLocal: 'EASY SALES',
      desLocal: '',
      dirLocal: ''
    });
  }
};

/**
 * @param {import('knex')} knex
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('parametros_impresion');
};