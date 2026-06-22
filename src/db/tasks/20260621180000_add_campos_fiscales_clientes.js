exports.up = async function (knex) {
  // 1. Agregar columnas si no existen
  const hasTipoDocumento = await knex.schema.hasColumn('clientes', 'tipoDocumento');
  if (!hasTipoDocumento) {
    await knex.schema.alterTable('clientes', table => {
      table.integer('tipoDocumento').nullable();
    });
  }

  const hasNroDocumento = await knex.schema.hasColumn('clientes', 'nroDocumento');
  if (!hasNroDocumento) {
    await knex.schema.alterTable('clientes', table => {
      table.bigInteger('nroDocumento').nullable();
    });
  }

  const hasCondicionIva = await knex.schema.hasColumn('clientes', 'condicionIva');
  if (!hasCondicionIva) {
    await knex.schema.alterTable('clientes', table => {
      table.integer('condicionIva').nullable();
    });
  }

  const hasRazonSocial = await knex.schema.hasColumn('clientes', 'razonSocial');
  if (!hasRazonSocial) {
    await knex.schema.alterTable('clientes', table => {
      table.string('razonSocial', 100).nullable();
    });
  }

  // 2. Backfill: clientes existentes (sin datos fiscales) pasan a Consumidor Final
  await knex('clientes')
    .whereNull('tipoDocumento')
    .update({ tipoDocumento: 99, condicionIva: 5 });
};

exports.down = async function (knex) {
  const hasTipoDocumento = await knex.schema.hasColumn('clientes', 'tipoDocumento');
  if (hasTipoDocumento) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('tipoDocumento');
    });
  }

  const hasNroDocumento = await knex.schema.hasColumn('clientes', 'nroDocumento');
  if (hasNroDocumento) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('nroDocumento');
    });
  }

  const hasCondicionIva = await knex.schema.hasColumn('clientes', 'condicionIva');
  if (hasCondicionIva) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('condicionIva');
    });
  }

  const hasRazonSocial = await knex.schema.hasColumn('clientes', 'razonSocial');
  if (hasRazonSocial) {
    await knex.schema.alterTable('clientes', table => {
      table.dropColumn('razonSocial');
    });
  }
};
