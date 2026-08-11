// Migration: ledger de cuenta corriente de proveedores (Fase 2, PR 4).
//
// Dos diferencias deliberadas respecto de `cuenta_corriente_movimientos` (clientes):
//
// 1. `tipo` es VARCHAR(20), no ENUM. La migración de clientes usa `table.enu(...)` y eso
//    obligó a una migración aparte cuando se agregó 'nota_credito'. Acá el union type
//    ('apertura'|'factura'|'pago'|'nota_credito'|'ajuste') se valida en TypeScript
//    (proveedorCuentaRepository.ts), no en la base.
//
// 2. LA CONVENCIÓN DE SIGNO ESTÁ INVERTIDA RESPECTO DE CLIENTES:
//      clientes:    debe = lo que EL CLIENTE me debe
//      proveedores: debe = lo que YO le debo al PROVEEDOR
//      saldo > 0 ⇒ le debo plata al proveedor
//      saldo < 0 ⇒ le pagué de más / tengo saldo a cuenta
//    Este es el bug más probable de todo el módulo: cualquiera que venga de leer el ledger
//    de clientes va a asumir la convención al revés. Repetido también en
//    proveedorCuentaRepository.ts a propósito, no alcanza con tenerlo acá.
//
// `anulado`: flag de estado para que la libreta (Fase 3) pueda tachar un pago anulado sin
// recalcular el saldo de filas históricas — el ledger es append-only, la anulación se
// compensa con un movimiento nuevo (`tipo='ajuste'`), nunca se edita uno viejo.
//
// Handoff: documentos/handoff_proveedores_fase2.md — PR 4.

exports.up = async function (knex) {
  const existe = await knex.schema.hasTable('proveedor_cuenta_movimientos');

  if (!existe) {
    await knex.schema.createTable('proveedor_cuenta_movimientos', table => {
      table.increments('id').primary();
      table.integer('idProveedor').unsigned().notNullable();
      table.date('fecha').notNullable();
      table.string('hora', 5).notNullable();
      table.string('tipo', 20).notNullable();
      table.string('descripcion', 200).nullable();
      table.string('comprobante', 30).nullable();
      table.date('fechaVencimiento').nullable();
      table.decimal('debe', 10, 2).notNullable().defaultTo(0);
      table.decimal('haber', 10, 2).notNullable().defaultTo(0);
      table.decimal('saldo', 10, 2).notNullable();
      table.integer('idTipoPago').nullable();
      table.integer('idCaja').nullable();
      table.integer('idReferencia').unsigned().nullable();
      table.integer('idCompra').nullable(); // hueco Fase 5 (compras), siempre NULL por ahora
      table.boolean('anulado').notNullable().defaultTo(false);

      table.foreign('idProveedor').references('proveedores.id');
      table.index(['idProveedor', 'id']); // acceso central: último saldo de un proveedor
    });
  }
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('proveedor_cuenta_movimientos');
};
