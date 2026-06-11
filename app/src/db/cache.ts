import { createClient, RedisClientType } from 'redis';
import { config } from '../config';
import { UserSession } from '../types';

export class CacheManager {
  private client: RedisClientType;
  private useMemory = false;
  // In-memory fallback used when Redis is unavailable (local testing only).
  private memory = new Map<string, { value: string; expireAt: number }>();
  private sessionTTL = 3600; // 1 hour (conversation state)
  private ledgerTTL = 86400; // 24 hours (DB mirror)

  constructor() {
    this.client = createClient({
      socket: {
        host: config.redis.host,
        port: config.redis.port,
        // Don't retry forever — if Redis is down we fall back to memory.
        reconnectStrategy: false,
      },
      password: config.redis.password,
    }) as RedisClientType;
    // Swallow background connection errors so they don't crash the process.
    this.client.on('error', () => {});
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.useMemory = false;
      console.log('⚡ Redis connected');
    } catch (err) {
      this.useMemory = true;
      console.warn(
        '⚠️  Redis 連線失敗，改用記憶體快取（僅供測試，資料不會持久化、重啟即消失）'
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.useMemory) {
      this.memory.clear();
      return;
    }
    try {
      await this.client.disconnect();
    } catch {
      /* already closed — ignore */
    }
  }

  private async setRaw(key: string, ttl: number, value: string): Promise<void> {
    if (this.useMemory) {
      this.memory.set(key, { value, expireAt: Date.now() + ttl * 1000 });
      return;
    }
    await this.client.setEx(key, ttl, value);
  }

  private async getRaw(key: string): Promise<string | null> {
    if (this.useMemory) {
      const entry = this.memory.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expireAt) {
        this.memory.delete(key);
        return null;
      }
      return entry.value;
    }
    return this.client.get(key);
  }

  private async delRaw(key: string): Promise<void> {
    if (this.useMemory) {
      this.memory.delete(key);
      return;
    }
    await this.client.del(key);
  }

  async setUserSession(userId: number, session: UserSession): Promise<void> {
    await this.setRaw(`session:${userId}`, this.sessionTTL, JSON.stringify(session));
  }

  async getUserSession(userId: number): Promise<UserSession | null> {
    const data = await this.getRaw(`session:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async deleteUserSession(userId: number): Promise<void> {
    await this.delRaw(`session:${userId}`);
  }

  async setLedgers(userId: number, ledgers: any[]): Promise<void> {
    await this.setRaw(`ledgers:${userId}`, this.ledgerTTL, JSON.stringify(ledgers));
  }

  async getLedgers(userId: number): Promise<any[] | null> {
    const data = await this.getRaw(`ledgers:${userId}`);
    return data ? JSON.parse(data) : null;
  }

  async invalidateLedgerCache(userId: number): Promise<void> {
    await this.delRaw(`ledgers:${userId}`);
  }
}

export const cacheManager = new CacheManager();
