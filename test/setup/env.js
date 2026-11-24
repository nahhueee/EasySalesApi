// Corre antes de importar nada de la app: fija NODE_ENV=test (=> config.test.json, sin listen ni crons).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env.test'), override: true });
if (process.env.NODE_ENV !== 'test') throw new Error('Los tests exigen NODE_ENV=test (.env.test).');
