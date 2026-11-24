// Recrea easysales_test antes de la corrida. db-reset-test.js tiene sus propias guardas
// (nombre de base, usuario y que no coincida con la base real).
const { main } = require('../../scripts/test/db-reset-test');

module.exports = async () => {
  const log = console.log;
  console.log = () => {};          // silencia el log de las migrations
  try { await main(); } finally { console.log = log; }
};
