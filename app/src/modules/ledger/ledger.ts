import { db } from '../../db/sqlite';
import { cacheManager } from '../../db/cache';
import { Ledger } from '../../types';
import { LEDGER_NAMES } from '../../constants';

export class LedgerModule {
  async createDefaultLedgers(_userId: number): Promise<void> {
    // No default ledgers — users start with a clean slate
  }

  async getUserLedgers(userId: number): Promise<Ledger[]> {
    // Try to get from cache
    const cached = await cacheManager.getLedgers(userId);
    if (cached) {
      return cached;
    }

    // Fetch from database
    const ledgers = await db.all<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? AND COALESCE(isArchived, 0) = 0 ORDER BY ledgerId',
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

  async getArchivedLedgers(userId: number): Promise<Ledger[]> {
    return db.all<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? AND COALESCE(isArchived, 0) = 1 ORDER BY ledgerId',
      [userId]
    );
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
      'SELECT * FROM ledgers WHERE userId = ? AND name = ? AND ledgerId <> ? AND COALESCE(isArchived, 0) = 0',
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

  async createLedger(userId: number, name: string, accountId?: number | null): Promise<Ledger> {
    const normalizedName = this.normalizeLedgerName(name);
    const duplicate = await db.get<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? AND name = ? AND COALESCE(isArchived, 0) = 0',
      [userId, normalizedName]
    );
    if (duplicate) {
      throw new Error('LEDGER_NAME_DUPLICATE');
    }

    const result = await db.run(
      'INSERT INTO ledgers (userId, name, isArchived, accountId) VALUES (?, ?, 0, ?)',
      [userId, normalizedName, accountId ?? null]
    );
    await cacheManager.invalidateLedgerCache(userId);

    const ledger = await this.getLedgerById(result.lastID, userId);
    return ledger as Ledger;
  }

  async archiveLedger(userId: number, ledgerId: number): Promise<void> {
    const activeLedgers = await this.getUserLedgers(userId);
    if (activeLedgers.length <= 1) {
      throw new Error('LEDGER_ARCHIVE_LAST_ACTIVE');
    }

    const result = await db.run(
      'UPDATE ledgers SET isArchived = 1, updatedAt = CURRENT_TIMESTAMP WHERE userId = ? AND ledgerId = ? AND COALESCE(isArchived, 0) = 0',
      [userId, ledgerId]
    );
    if (!result.changes) {
      throw new Error('LEDGER_NOT_FOUND');
    }

    await cacheManager.invalidateLedgerCache(userId);
  }

  async unarchiveLedger(userId: number, ledgerId: number): Promise<void> {
    const ledger = await this.getLedgerById(ledgerId, userId);
    if (!ledger) {
      throw new Error('LEDGER_NOT_FOUND');
    }

    const duplicate = await db.get<Ledger>(
      'SELECT * FROM ledgers WHERE userId = ? AND name = ? AND ledgerId <> ? AND COALESCE(isArchived, 0) = 0',
      [userId, ledger.name, ledgerId]
    );
    if (duplicate) {
      throw new Error('LEDGER_NAME_DUPLICATE');
    }

    const result = await db.run(
      'UPDATE ledgers SET isArchived = 0, updatedAt = CURRENT_TIMESTAMP WHERE userId = ? AND ledgerId = ? AND COALESCE(isArchived, 0) = 1',
      [userId, ledgerId]
    );
    if (!result.changes) {
      throw new Error('LEDGER_NOT_FOUND');
    }

    await cacheManager.invalidateLedgerCache(userId);
  }

  private normalizeLedgerName(name: string): string {
    const normalizedName = name.trim();
    if (!normalizedName) {
      throw new Error('LEDGER_NAME_EMPTY');
    }
    if (normalizedName.length > 30) {
      throw new Error('LEDGER_NAME_TOO_LONG');
    }
    return normalizedName;
  }
}

export const ledgerModule = new LedgerModule();
