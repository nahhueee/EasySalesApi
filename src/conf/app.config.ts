import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const rawConfig = fs.readFileSync(path.resolve(__dirname, '../../config.json'), 'utf-8');
const configs = JSON.parse(rawConfig);

const env = process.env.NODE_ENV || 'pc';
const config = configs[env];

if (!config) {
  throw new Error(`No configuration found for environment: ${env}`);
}

export default config;

