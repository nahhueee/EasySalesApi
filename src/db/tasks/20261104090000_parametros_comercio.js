/**
 * Migration: Fase 3.4-P — configuración del comercio en `parametros` (antes vivía en localStorage, por PC).
 * Ver documentos/handoff_fase3_4p_config_comercio.md §3.1.
 *
 * Inserta las 13 claves de Preferencias con el valor centinela '__sin_migrar__' = "ninguna terminal
 * subió todavía su configuración". La primera terminal que arranca con la versión nueva las importa
 * desde su localStorage (POST /parametros/comercio/importar, solo escribe sobre el centinela).
 *
 * Por qué centinela y no NULL: `parametros.valor` es VARCHAR(50) NOT NULL DEFAULT '' en el schema base
 * y en los 3 backups reales de diagnóstico (A, B y C). No se hace ALTER de la columna para esto.
 * '__sin_migrar__' (14 caracteres) entra de sobra. Nadie más lee estas claves: los getters viejos
 * de localStorage no pasan por acá, y GET /parametros/obtener/:clave no se usa con ellas.
 *
 * `configComercioRevisada` = marca del aviso único al admin. 'true' = nada que avisar; la pone en
 * 'false' la importación (si escribió algo) y vuelve a 'true' al guardar Preferencias o tocar "Entendido".
 *
 * Idempotente: solo inserta lo que falta; nunca pisa un valor ya migrado. `down` borra solo estas claves.
 */

const SIN_MIGRAR = '__sin_migrar__';

const CLAVES_COMERCIO = [
  'ventasYtotales', 'resumenCaja', 'ventasCliente', 'gestionClientes', 'cambioPrecio',
  'borrarVentas', 'ventaCC',
  'iva', 'listasPrecios', 'presupuestos', 'vencimientos', 'precioEditableVenta', 'edicionResultadoUnico',
];

const CLAVE_REVISADA = 'configComercioRevisada';

exports.up = async function (knex) {
  const existentes = (await knex('parametros').whereIn('clave', [...CLAVES_COMERCIO, CLAVE_REVISADA]).select('clave'))
    .map(r => r.clave);

  const nuevas = CLAVES_COMERCIO
    .filter(clave => !existentes.includes(clave))
    .map(clave => ({ clave, valor: SIN_MIGRAR }));

  if (!existentes.includes(CLAVE_REVISADA)) {
    nuevas.push({ clave: CLAVE_REVISADA, valor: 'true' });
  }

  if (nuevas.length) {
    await knex('parametros').insert(nuevas);
  }
};

exports.down = async function (knex) {
  await knex('parametros').whereIn('clave', [...CLAVES_COMERCIO, CLAVE_REVISADA]).del();
};
