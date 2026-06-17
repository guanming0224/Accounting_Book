import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'API/.env') });

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
  },
  google: {
    credentialsPath: process.env.GOOGLE_SHEETS_CREDENTIALS || '',
    sheetsId: process.env.GOOGLE_SHEETS_ID || '',
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  database: {
    path: process.env.DB_PATH || './app/data/accounting.db',
  },
  env: process.env.NODE_ENV || 'development',
};
