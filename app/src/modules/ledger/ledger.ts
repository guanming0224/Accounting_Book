import { db } from '../../db/sqlite';
import { cacheManager } from '../../db/cache';
import { Ledger } from '../../types';
import { LEDGER_NAMES } from '../../constants';

export class LedgerModule {
  async createDefaultLedgers(userId: number): Promise<void> {
    // Check if user already has ledgers
    const existing = await db.get(
      'SELECT COUNT(*) as count FROM ledgers WHERE userId = ?',
      [userId]
    ) as any;

    if (existing.count > 0) {
      return;
    }

    // Create 5 default ledgers
    for (let i = 1; i <= 5; i++) {
      const name = LEDGER_NAMES[i as keyof typeof LEDGER_NAMES];
      await db.run(
        'INSERT INTO ledgers (userId, name) VALUES (?, ?)',
        [userId, name]
      );
    }

    // Invalidate cache
    await cacheManager.invalidateLedgerCache(userId);
  }

  async getUserLedgers(userId: number): Promise<Ledger[]> {
    // Try to get from cache
    const cached = await cacheManager.getLedgers(userId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const ledgers = await db.all<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? ORDER BY ledgerId',
      [userId]
    );

    // Cache the result
    await cacheManager.setLedgers(userId, ledgers);
    return ledgers;
  }

  async getLedgerById(ledgerId: number, userId: number): Promise<Ledger | null> {
    const ledger = await db.get<Ledger>(
      'SELECT * FROM ledgers WHERE ledgerId = ? AND userId = ?',
      [ledgerId, userId]
    );
    return ledger || null;
  }
}

export const ledgerModule = new LedgerModule();
