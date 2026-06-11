import { db } from './db/sqlite';
import { cacheManager } from './db/cache';
import { googleSheetsIntegration } from './integrations/GoogleSheets';
import { BotHandlers } from './handlers/TelegramHandler';
import { config } from './config';

async function main() {
  try {
    console.log('🚀 Starting Telegram Accounting Bot...');

    // Initialize database
    console.log('📊 Initializing database...');
    await db.initialize();

    // Initialize Redis cache
    console.log('⚡ Connecting to Redis...');
    await cacheManager.connect();

    // Initialize Google Sheets (optional, will continue if fails)
    try {
      console.log('📈 Authenticating with Google Sheets...');
      await googleSheetsIntegration.authenticate();
    } catch (err) {
      console.warn('⚠️  Google Sheets authentication failed, continuing without it');
    }

    // Start Telegram Bot
    if (!config.telegram.token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set in environment variables');
    }

    console.log('🤖 Starting Telegram Bot...');
    const botHandlers = new BotHandlers(config.telegram.token);
    await botHandlers.start();

    console.log('✅ Accounting Bot is running!');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n🛑 Shutting down gracefully...');
      await botHandlers.stop();
      await cacheManager.disconnect();
      await db.close();
      console.log('👋 Goodbye!');
      process.exit(0);
    });
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

main();
