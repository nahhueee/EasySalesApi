// Migration: convertir cajas.id de PK manual (generado por la app, ObtenerUltimaCaja) a
// AUTO_INCREMENT (Lote 4, Fase 2 — ver documentos/handoff_fase2_correcciones.md).
//
// MySQL no permite ALTER TABLE ... MODIFY sobre una columna referenciada por una FK de otra
// tabla ("Cannot change column 'id': used in a foreign key constraint"), aunque el tipo no
// cambie — agregar AUTO_INCREMENT alcanza para dispararlo. Hay que soltar las FKs que apuntan
// a cajas.id, hacer el MODIFY, y volver a crearlas. Se descubren dinámicamente vía
// information_schema (no se hardcodean nombres/tablas) para no asumir cuáles son hoy — mismo
// enfoque que 20260724090000_cajas_movimientos_fk_set_null.js.

async function obtenerFksHaciaCajasId(knex) {
  return knex('information_schema.KEY_COLUMN_USAGE as kcu')
    .join('information_schema.REFERENTIAL_CONSTRAINTS as rc', function () {
      this.on('rc.CONSTRAINT_NAME', '=', 'kcu.CONSTRAINT_NAME')
          .andOn('rc.CONSTRAINT_SCHEMA', '=', 'kcu.CONSTRAINT_SCHEMA');
    })
    .where('kcu.CONSTRAINT_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('kcu.REFERENCED_TABLE_NAME', 'cajas')
    .andWhere('kcu.REFERENCED_COLUMN_NAME', 'id')
    .select(
      'kcu.TABLE_NAME as tabla',
      'kcu.COLUMN_NAME as columna',
      'kcu.CONSTRAINT_NAME as nombre',
      'rc.DELETE_RULE as reglaBorrado',
      'rc.UPDATE_RULE as reglaUpdate'
    );
}

async function esYaAutoIncrement(knex) {
  const [col] = await knex('information_schema.COLUMNS')
    .where('TABLE_SCHEMA', knex.raw('DATABASE()'))
    .andWhere('TABLE_NAME', 'cajas')
    .andWhere('COLUMN_NAME', 'id')
    .select('EXTRA as extra');
  return !!col && /auto_increment/i.test(col.extra);
}

exports.up = async function (knex) {
  // Idempotente: si ya es AUTO_INCREMENT (reintento tras fallo parcial), no volver a tocar FKs.
  if (await esYaAutoIncrement(knex)) return;

  const fks = await obtenerFksHaciaCajasId(knex);

  for (const fk of fks) {
    await knex.raw(`ALTER TABLE \`${fk.tabla}\` DROP FOREIGN KEY \`${fk.nombre}\``);
  }

  await knex.raw('ALTER TABLE cajas MODIFY id INT NOT NULL AUTO_INCREMENT');

  // Fijar el contador en MAX(id)+1 para no colisionar con los ids ya insertados a mano.
  const ultimo = await knex('cajas').max('id as maxId').first();
  const proximoId = (ultimo && ultimo.maxId ? ultimo.maxId : 0) + 1;
  await knex.raw(`ALTER TABLE cajas AUTO_INCREMENT = ${proximoId}`);

  for (const fk of fks) {
    const onDelete = fk.reglaBorrado && fk.reglaBorrado !== 'NO ACTION' ? ` ON DELETE ${fk.reglaBorrado}` : '';
    const onUpdate = fk.reglaUpdate && fk.reglaUpdate !== 'NO ACTION' ? ` ON UPDATE ${fk.reglaUpdate}` : '';
    await knex.raw(
      `ALTER TABLE \`${fk.tabla}\` ADD CONSTRAINT \`${fk.nombre}\` FOREIGN KEY (\`${fk.columna}\`) REFERENCES \`cajas\`(\`id\`)${onDelete}${onUpdate}`
    );
  }
};

exports.down = async function (knex) {
  if (!(await esYaAutoIncrement(knex))) return;

  const fks = await obtenerFksHaciaCajasId(knex);

  for (const fk of fks) {
    await knex.raw(`ALTER TABLE \`${fk.tabla}\` DROP FOREIGN KEY \`${fk.nombre}\``);
  }

  await knex.raw('ALTER TABLE cajas MODIFY id INT NOT NULL');

  for (const fk of fks) {
    const onDelete = fk.reglaBorrado && fk.reglaBorrado !== 'NO ACTION' ? ` ON DELETE ${fk.reglaBorrado}` : '';
    const onUpdate = fk.reglaUpdate && fk.reglaUpdate !== 'NO ACTION' ? ` ON UPDATE ${fk.reglaUpdate}` : '';
    await knex.raw(
      `ALTER TABLE \`${fk.tabla}\` ADD CONSTRAINT \`${fk.nombre}\` FOREIGN KEY (\`${fk.columna}\`) REFERENCES \`cajas\`(\`id\`)${onDelete}${onUpdate}`
    );
  }
};
