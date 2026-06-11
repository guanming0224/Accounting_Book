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
}

export const transactionModule = new TransactionModule();
