// Amplía la precisión de "cantidad" a 3 decimales para soportar kilos con gramos
// exactos en productos pesables (unidad = 'KG'). Alcance: solo las tablas donde
// cantidad puede representar kg cargados en una venta/nota de crédito o el stock
// de un producto pesable. Alinea con presupuestos_detalle.cantidad, que ya está
// en DECIMAL(10,3) desde su creación (20260605120000_presupuestos.js) — antes de
// este cambio el esquema ya era inconsistente entre módulos.
//
// No es destructivo: DECIMAL(10,2) -> DECIMAL(10,3) solo agrega precisión, los
// valores existentes no se alteran (se completan con 0 en el nuevo decimal).
exports.up = async function (knex) {
  await knex.schema.alterTable('productos', table => {
    table.decimal('cantidad', 10, 3).alter();
  });

  await knex.schema.alterTable('ventas_detalle', table => {
    table.decimal('cantidad', 10, 3).alter();
  });

  await knex.schema.alterTable('notas_credito_detalle', table => {
    table.decimal('cantidad', 10, 3).alter();
  });
};

exports.down = async function (knex) {
  // Orden inverso; nota: si ya se cargaron cantidades con 3 decimales reales
  // (ej. 2.500 kg), el rollback las trunca a 2 decimales (2.50) - no hay forma
  // de volver atrás sin pérdida de precisión, es inherente a la operación.
  await knex.schema.alterTable('notas_credito_detalle', table => {
    table.decimal('cantidad', 10, 2).alter();
  });

  await knex.schema.alterTable('ventas_detalle', table => {
    table.decimal('cantidad', 10, 2).alter();
  });

  await knex.schema.alterTable('productos', table => {
    table.decimal('cantidad', 10, 2).alter();
  });
};
