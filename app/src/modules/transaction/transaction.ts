import { db } from '../../db/sqlite';
import { Transaction, TransactionType, PaymentMethod } from '../../types';

export class TransactionModule {
  async createTransaction(
    ledgerId: number,
    type: TransactionType,
    amount: number,
    category: string,
    subcategory: string,
    paymentMethod: PaymentMethod,
    description?: string
  ): Promise<Transaction> {
    const result = await db.run(
      `INSERT INTO transactions (ledgerId, type, amount, category, subcategory, paymentMethod, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ledgerId, type, amount, category, subcategory, paymentMethod, description || '']
    );

    // Fetch the row we just inserted by its primary key (reliable under concurrency).
    const transaction = await db.get<Transaction>(
      `SELECT * FROM transactions WHERE transactionId = ?`,
      [result.lastID]
    );

    return transaction!;
  }

  async getTransactionsByLedger(
    ledgerId: number,
    limit: number = 50
  ): Promise<Transaction[]> {
    return db.all<Transaction>(
      `SELECT * FROM transactions WHERE ledgerId = ? ORDER BY createdAt DESC LIMIT ?`,
      [ledgerId, limit]
    );
  }

  async getTransactionByIdForLedger(
    transactionId: number,
    ledgerId: number
  ): Promise<Transaction | null> {
    const transaction = await db.get<Transaction>(
      `SELECT * FROM transactions WHERE transactionId = ? AND ledgerId = ?`,
      [transactionId, ledgerId]
    );
    return transaction || null;
  }

  async getTransactionsByLedgerAndDateRange(
    ledgerId: number,
    startDate: string,
    endDate: string,
    limit: number = 10
  ): Promise<Transaction[]> {
    return db.all<Transaction>(
      `SELECT * FROM transactions
       WHERE ledgerId = ? AND createdAt >= ? AND createdAt < ?
       ORDER BY createdAt DESC
       LIMIT ?`,
      [ledgerId, startDate, endDate, limit]
    );
  }

  async getLedgerStats(ledgerId: number): Promise<any> {
    const stats = await db.get<any>(
      `SELECT 
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as totalIncome,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as totalExpense,
        COUNT(*) as transactionCount
      FROM transactions
      WHERE ledgerId = ?`,
      [ledgerId]
    );
    return stats || { totalIncome: 0, totalExpense: 0, transactionCount: 0 };
  }

  async getLedgerStatsByDateRange(
    ledgerId: number,
    startDate: string,
    endDate: string
  ): Promise<any> {
    const stats = await db.get<any>(
      `SELECT 
        SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as totalIncome,
        SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as totalExpense,
        COUNT(*) as transactionCount
      FROM transactions
      WHERE ledgerId = ? AND createdAt >= ? AND createdAt < ?`,
      [ledgerId, startDate, endDate]
    );
    return stats || { totalIncome: 0, totalExpense: 0, transactionCount: 0 };
  }

  async getCategorySummaryByDateRange(
    ledgerId: number,
    startDate: string,
    endDate: string
  ): Promise<Array<{ type: TransactionType; category: string; total: number }>> {
    return db.all(
      `SELECT type, category, SUM(amount) as total
       FROM transactions
       WHERE ledgerId = ? AND createdAt >= ? AND createdAt < ?
       GROUP BY type, category
       ORDER BY type, total DESC`,
      [ledgerId, startDate, endDate]
    );
  }

  async updateTransactionAmount(
    transactionId: number,
    ledgerId: number,
    amount: number
  ): Promise<Transaction> {
    const result = await db.run(
      'UPDATE transactions SET amount = ? WHERE transactionId = ? AND ledgerId = ?',
      [amount, transactionId, ledgerId]
    );
    if (!result.changes) {
      throw new Error('TRANSACTION_NOT_FOUND');
    }

    const transaction = await this.getTransactionByIdForLedger(transactionId, ledgerId);
    return transaction as Transaction;
  }

  async updateTransactionDescription(
    transactionId: number,
    ledgerId: number,
    description: string
  ): Promise<Transaction> {
    const result = await db.run(
      'UPDATE transactions SET description = ? WHERE transactionId = ? AND ledgerId = ?',
      [description, transactionId, ledgerId]
    );
    if (!result.changes) {
      throw new Error('TRANSACTION_NOT_FOUND');
    }

    const transaction = await this.getTransactionByIdForLedger(transactionId, ledgerId);
    return transaction as Transaction;
  }

  async deleteTransaction(transactionId: number, ledgerId: number): Promise<void> {
    const result = await db.run(
      'DELETE FROM transactions WHERE transactionId = ? AND ledgerId = ?',
      [transactionId, ledgerId]
    );
    if (!result.changes) {
      throw new Error('TRANSACTION_NOT_FOUND');
    }
  }
}

export const transactionModule = new TransactionModule();
