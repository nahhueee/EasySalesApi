exports.up = function (knex) {
  return knex.schema
    .dropTableIfExists('parametros_impresion')
    .then(function () {
      return knex.schema.createTable('parametros_impresion', function (table) {
        table.string('impresora', 100);
        table.string('papel', 10);
        table.integer('margenIzq').defaultTo(0);
        table.integer('margenDer').defaultTo(0);
        table.string('nomLocal', 100);
        table.string('desLocal', 100);
        table.string('dirLocal', 150);
      });
    })
    .then(function () {
      return knex('parametros_impresion').insert({
        impresora: '',
        papel: '58mm',
        margenIzq: 0,
        margenDer: 0,
        nomLocal: 'EASY SALES',
        desLocal: '',
        dirLocal: ''
      });
    });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('parametros_impresion');
};
