const path = require('path');
const fs = require('fs');

const env = process.env.NODE_ENV || 'pc';
const configPath = path.resolve(__dirname, `../config.${env}.json`);

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
module.exports = {
  development: {
      client: 'mysql2', 
      connection: {
        host: config.db.host,
        user: config.db.user,
        password: config.db.password,
        database: config.db.database
      },
      migrations: {
        directory: path.resolve(__dirname, '../src/db/tasks')
      },
      seeds: {
        directory: path.resolve(__dirname, '../src/db/seeds')
      }
    }
};
  