// Migration: ampliar usuarios.pass a VARCHAR(72) y rehashear passwords en texto plano
// a bcrypt (Lote 2, Fase 2 — ver documentos/handoff_fase2_correcciones.md).
//
// Orden importa: el ALTER va antes del rehash. Un hash bcrypt son 60 caracteres; con la
// columna en VARCHAR(30) (script.sql), MySQL trunca en silencio y nadie vuelve a entrar
// al sistema sin ningún error visible.
//
// Idempotente: si una password ya empieza con "$2" (prefijo de hash bcrypt), se saltea.
// Necesario porque si se corriera dos veces hashearía el hash y nadie entraría más.

const bcrypt = require('bcryptjs');

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE usuarios MODIFY pass VARCHAR(72)');

  const usuarios = await knex('usuarios').select('id', 'pass');

  for (const usuario of usuarios) {
    if (!usuario.pass || usuario.pass.startsWith('$2')) continue; // vacío o ya hasheado

    const hash = await bcrypt.hash(usuario.pass, 10);
    await knex('usuarios').where('id', usuario.id).update({ pass: hash });
  }
};

exports.down = async function (knex) {
  // No se puede "deshashear" — no hay vuelta atrás para las passwords ya migradas.
  // Solo revertimos el ancho de columna, para no dejar el schema en un estado raro
  // si se necesita un down por otro motivo.
  await knex.raw('ALTER TABLE usuarios MODIFY pass VARCHAR(30)');
};
