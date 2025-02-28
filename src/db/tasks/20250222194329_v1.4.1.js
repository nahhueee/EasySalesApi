exports.up = function(knex) {
    return knex('parametros').insert({ clave: 'actualizacion', valor: 'false' });
};
  
exports.down = function(knex) {
    return knex('parametros').where('actualizacion', 'false').del();
};
  