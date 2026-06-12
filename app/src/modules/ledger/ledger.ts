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

  async renameLedger(userId: number, ledgerId: number, newName: string): Promise<Ledger> {
    const normalizedName = newName.trim();
    if (!normalizedName) {
      throw new Error('LEDGER_NAME_EMPTY');
    }
    if (normalizedName.length > 30) {
      throw new Error('LEDGER_NAME_TOO_LONG');
    }

    const ledger = await this.getLedgerById(ledgerId, userId);
    if (!ledger) {
      throw new Error('LEDGER_NOT_FOUND');
    }

    const duplicate = await db.get<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? AND name = ? AND ledgerId <> ?',
      [userId, normalizedName, ledgerId]
    );
    if (duplicate) {
      throw new Error('LEDGER_NAME_DUPLICATE');
    }

    await db.run(
      'UPDATE ledgers SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE ledgerId = ? AND userId = ?',
      [normalizedName, ledgerId, userId]
    );
    await cacheManager.invalidateLedgerCache(userId);

    const renamedLedger = await this.getLedgerById(ledgerId, userId);
    return renamedLedger as Ledger;
  }
}

export const ledgerModule = new LedgerModule();
