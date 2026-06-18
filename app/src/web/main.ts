import express, { Request, Response } from 'express';
import path from 'path';
import { db } from '../db/sqlite';
import { cacheManager } from '../db/cache';
import { userModule } from '../modules/user/user';
import { ledgerModule } from '../modules/ledger/ledger';
import { settingsModule } from '../modules/settings/settings';
import { transactionModule } from '../modules/transaction/transaction';
import { TransactionType } from '../types';

const DEFAULT_WEB_USER_ID = 0;
const PORT = Number(process.env.WEB_PORT || 3000);

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((err) => {
      console.error('Web API error:', err);
      const message = err instanceof Error ? err.message : 'UNKNOWN_ERROR';
      res.status(400).json({ error: message });
    });
  };
}

function taipeiMidnightUtc(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000);
}

function sqliteDate(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function getTaipeiTodayParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function parseDateRange(req: Request): { startDate: string; endDate: string } {
  const startText = String(req.query.start || '');
  const endText = String(req.query.end || '');
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startText) || !datePattern.test(endText)) {
    throw new Error('DATE_RANGE_REQUIRED');
  }

  const [startYear, startMonth, startDay] = startText.split('-').map(Number);
  const [endYear, endMonth, endDay] = endText.split('-').map(Number);
  const start = taipeiMidnightUtc(startYear, startMonth, startDay);
  const inclusiveEnd = taipeiMidnightUtc(endYear, endMonth, endDay);
  const end = new Date(inclusiveEnd.getTime() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw new Error('INVALID_DATE_RANGE');
  }

  return { startDate: sqliteDate(start), endDate: sqliteDate(end) };
}

function currentMonthRange(): { startDate: string; endDate: string } {
  const { year, month } = getTaipeiTodayParts();
  const start = taipeiMidnightUtc(year, month, 1);
  const end = month === 12 ? taipeiMidnightUtc(year + 1, 1, 1) : taipeiMidnightUtc(year, month + 1, 1);
  return { startDate: sqliteDate(start), endDate: sqliteDate(end) };
}

function monthRangeForYearMonth(year: number, month: number): { startDate: string; endDate: string } {
  const start = taipeiMidnightUtc(year, month, 1);
  const end = month === 12 ? taipeiMidnightUtc(year + 1, 1, 1) : taipeiMidnightUtc(year, month + 1, 1);
  return { startDate: sqliteDate(start), endDate: sqliteDate(end) };
}

async function resolveUserId(req: Request): Promise<number> {
  const rawUserId = req.query.userId || req.header('x-user-id') || req.body?.userId;
  if (rawUserId !== undefined) {
    const userId = Number(rawUserId);
    if (!Number.isNaN(userId)) {
      await userModule.getOrCreateUser(userId, `user_${userId}`);
      await ledgerModule.createDefaultLedgers(userId);
      await settingsModule.initializeDefaults(userId);
      return userId;
    }
  }

  const users = await userModule.getAllUsers();
  const userId = users[0]?.userId ?? DEFAULT_WEB_USER_ID;
  await userModule.getOrCreateUser(userId, users[0]?.username || 'web_local');
  await ledgerModule.createDefaultLedgers(userId);
  await settingsModule.initializeDefaults(userId);
  return userId;
}

async function getSettings(userId: number) {
  const [paymentMethods, expenseCategories, incomeCategories] = await Promise.all([
    settingsModule.getPaymentMethods(userId),
    settingsModule.getCategories(userId, 'expense'),
    settingsModule.getCategories(userId, 'income'),
  ]);
  return { paymentMethods, expenseCategories, incomeCategories };
}

async function startWebServer() {
  await db.initialize();
  await cacheManager.connect();

  const app = express();
  app.use(express.json());

  app.get('/api/context', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const users = await userModule.getAllUsers();
    res.json({ userId, users });
  }));

  app.get('/api/dashboard', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const ledgers = await ledgerModule.getUserLedgers(userId);
    const range = currentMonthRange();
    const totals = { totalIncome: 0, totalExpense: 0, transactionCount: 0 };
    const ledgerStats = [];
    const expenseCategoryMap = new Map<string, number>();

    for (const ledger of ledgers) {
      const stats = await transactionModule.getLedgerStatsByDateRange(
        ledger.ledgerId,
        range.startDate,
        range.endDate
      );
      totals.totalIncome += stats.totalIncome || 0;
      totals.totalExpense += stats.totalExpense || 0;
      totals.transactionCount += stats.transactionCount || 0;
      ledgerStats.push({
        ledgerId: ledger.ledgerId,
        name: ledger.name,
        totalIncome: stats.totalIncome || 0,
        totalExpense: stats.totalExpense || 0,
        balance: (stats.totalIncome || 0) - (stats.totalExpense || 0),
        transactionCount: stats.transactionCount || 0,
      });

      const categorySummary = await transactionModule.getCategorySummaryByDateRange(
        ledger.ledgerId,
        range.startDate,
        range.endDate
      );
      for (const item of categorySummary) {
        if (item.type !== 'expense') continue;
        expenseCategoryMap.set(item.category, (expenseCategoryMap.get(item.category) || 0) + item.total);
      }
    }

    res.json({
      ...totals,
      balance: totals.totalIncome - totals.totalExpense,
      ledgerCount: ledgers.length,
      ledgerStats,
      expenseCategories: Array.from(expenseCategoryMap.entries())
        .map(([category, total]) => ({ category, total }))
        .sort((a, b) => b.total - a.total),
    });
  }));

  app.get('/api/ledgers', asyncHandler(async (req, res) => {
    res.json(await ledgerModule.getUserLedgers(await resolveUserId(req)));
  }));

  app.get('/api/ledgers/archived', asyncHandler(async (req, res) => {
    res.json(await ledgerModule.getArchivedLedgers(await resolveUserId(req)));
  }));

  app.post('/api/ledgers', asyncHandler(async (req, res) => {
    const ledger = await ledgerModule.createLedger(await resolveUserId(req), String(req.body.name || ''));
    res.json(ledger);
  }));

  app.patch('/api/ledgers/:id/name', asyncHandler(async (req, res) => {
    const ledger = await ledgerModule.renameLedger(
      await resolveUserId(req),
      Number(req.params.id),
      String(req.body.name || '')
    );
    res.json(ledger);
  }));

  app.patch('/api/ledgers/:id/archive', asyncHandler(async (req, res) => {
    await ledgerModule.archiveLedger(await resolveUserId(req), Number(req.params.id));
    res.json({ ok: true });
  }));

  app.patch('/api/ledgers/:id/unarchive', asyncHandler(async (req, res) => {
    await ledgerModule.unarchiveLedger(await resolveUserId(req), Number(req.params.id));
    res.json({ ok: true });
  }));

  app.get('/api/transactions', asyncHandler(async (req, res) => {
    const ledgerId = Number(req.query.ledgerId);
    if (Number.isNaN(ledgerId)) throw new Error('LEDGER_ID_REQUIRED');
    const { startDate, endDate } = parseDateRange(req);
    const [stats, transactions, categorySummary] = await Promise.all([
      transactionModule.getLedgerStatsByDateRange(ledgerId, startDate, endDate),
      transactionModule.getTransactionsByLedgerAndDateRange(ledgerId, startDate, endDate, 100),
      transactionModule.getCategorySummaryByDateRange(ledgerId, startDate, endDate),
    ]);
    res.json({ stats, transactions, categorySummary });
  }));

  app.patch('/api/transactions/:id/amount', asyncHandler(async (req, res) => {
    const transaction = await transactionModule.getTransactionById(Number(req.params.id));
    if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');
    const amount = Number(req.body.amount);
    if (Number.isNaN(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
    res.json(await transactionModule.updateTransactionAmount(transaction.transactionId, transaction.ledgerId, amount));
  }));

  app.patch('/api/transactions/:id/note', asyncHandler(async (req, res) => {
    const transaction = await transactionModule.getTransactionById(Number(req.params.id));
    if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');
    res.json(
      await transactionModule.updateTransactionDescription(
        transaction.transactionId,
        transaction.ledgerId,
        String(req.body.description || '')
      )
    );
  }));

  app.delete('/api/transactions/:id', asyncHandler(async (req, res) => {
    const transaction = await transactionModule.getTransactionById(Number(req.params.id));
    if (!transaction) throw new Error('TRANSACTION_NOT_FOUND');
    await transactionModule.deleteTransaction(transaction.transactionId, transaction.ledgerId);
    res.json({ ok: true });
  }));

  app.get('/api/settings', asyncHandler(async (req, res) => {
    res.json(await getSettings(await resolveUserId(req)));
  }));

  app.post('/api/settings/payment', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.addPaymentMethod(userId, String(req.body.name || ''));
    res.json(await getSettings(userId));
  }));

  app.patch('/api/settings/payment', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.renamePaymentMethod(userId, String(req.body.oldName || ''), String(req.body.newName || ''));
    res.json(await getSettings(userId));
  }));

  app.delete('/api/settings/payment', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.deletePaymentMethod(userId, String(req.query.name || ''));
    res.json(await getSettings(userId));
  }));

  app.post('/api/settings/category', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.addCategory(userId, req.body.type as TransactionType, String(req.body.name || ''));
    res.json(await getSettings(userId));
  }));

  app.patch('/api/settings/category', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.renameCategory(
      userId,
      req.body.type as TransactionType,
      String(req.body.oldName || ''),
      String(req.body.newName || '')
    );
    res.json(await getSettings(userId));
  }));

  app.delete('/api/settings/category', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.deleteCategory(
      userId,
      String(req.query.type || '') as TransactionType,
      String(req.query.name || '')
    );
    res.json(await getSettings(userId));
  }));

  app.post('/api/settings/subcategory', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.addSubcategory(
      userId,
      req.body.type as TransactionType,
      String(req.body.categoryName || ''),
      String(req.body.name || '')
    );
    res.json(await getSettings(userId));
  }));

  app.patch('/api/settings/subcategory', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.renameSubcategory(
      userId,
      req.body.type as TransactionType,
      String(req.body.categoryName || ''),
      String(req.body.oldName || ''),
      String(req.body.newName || '')
    );
    res.json(await getSettings(userId));
  }));

  app.delete('/api/settings/subcategory', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    await settingsModule.deleteSubcategory(
      userId,
      String(req.query.type || '') as TransactionType,
      String(req.query.categoryName || ''),
      String(req.query.name || '')
    );
    res.json(await getSettings(userId));
  }));

  // ── Create transaction from web ──────────────────────────────────────────
  app.post('/api/transactions', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const { ledgerId, type, amount, category, subcategory, paymentMethod, description } = req.body;
    const ledgers = await ledgerModule.getUserLedgers(userId);
    if (!ledgers.find((l) => l.ledgerId === Number(ledgerId))) throw new Error('LEDGER_NOT_FOUND');
    const amountNum = Number(amount);
    if (Number.isNaN(amountNum) || amountNum <= 0) throw new Error('INVALID_AMOUNT');
    if (!['expense', 'income'].includes(String(type))) throw new Error('INVALID_TYPE');
    if (!category) throw new Error('CATEGORY_REQUIRED');
    if (!subcategory) throw new Error('SUBCATEGORY_REQUIRED');
    if (!paymentMethod) throw new Error('PAYMENT_METHOD_REQUIRED');
    const transaction = await transactionModule.createTransaction(
      Number(ledgerId), type as TransactionType, amountNum,
      String(category), String(subcategory), String(paymentMethod), String(description || '')
    );
    res.json(transaction);
  }));

  // ── Budgets ──────────────────────────────────────────────────────────────
  app.get('/api/budgets', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const { year, month } = getTaipeiTodayParts();
    const y = Number(req.query.year || year);
    const m = Number(req.query.month || month);
    const budgets = await db.all<any>(
      'SELECT * FROM budgets WHERE userId = ? AND year = ? AND month = ? ORDER BY category',
      [userId, y, m]
    );
    const { startDate, endDate } = monthRangeForYearMonth(y, m);
    const ledgers = await ledgerModule.getUserLedgers(userId);
    const actualMap = new Map<string, number>();
    for (const ledger of ledgers) {
      const summary = await transactionModule.getCategorySummaryByDateRange(ledger.ledgerId, startDate, endDate);
      for (const item of summary) {
        if (item.type === 'expense') {
          actualMap.set(item.category, (actualMap.get(item.category) || 0) + item.total);
        }
      }
    }
    res.json(budgets.map((b) => ({ ...b, actual: actualMap.get(b.category) || 0 })));
  }));

  app.post('/api/budgets', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const { category, amount, year, month } = req.body;
    if (!category) throw new Error('CATEGORY_REQUIRED');
    const amountNum = Number(amount);
    if (Number.isNaN(amountNum) || amountNum < 0) throw new Error('INVALID_AMOUNT');
    await db.run(
      `INSERT INTO budgets (userId, category, amount, year, month)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(userId, category, year, month) DO UPDATE SET
         amount = excluded.amount, updatedAt = CURRENT_TIMESTAMP`,
      [userId, String(category), amountNum, Number(year), Number(month)]
    );
    res.json({ ok: true });
  }));

  app.delete('/api/budgets/:id', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const result = await db.run(
      'DELETE FROM budgets WHERE budgetId = ? AND userId = ?',
      [Number(req.params.id), userId]
    );
    if (!result.changes) throw new Error('BUDGET_NOT_FOUND');
    res.json({ ok: true });
  }));

  // ── Monthly trend (last N months across all active ledgers) ──────────────
  app.get('/api/reports/trend', asyncHandler(async (req, res) => {
    const userId = await resolveUserId(req);
    const months = Math.min(Math.max(Number(req.query.months || 6), 1), 24);
    const { year, month } = getTaipeiTodayParts();

    let startYear = year;
    let startMonth = month - months + 1;
    while (startMonth <= 0) { startMonth += 12; startYear--; }
    const startDate = sqliteDate(taipeiMidnightUtc(startYear, startMonth, 1));

    const rows = await db.all<{ yearMonth: string; totalIncome: number; totalExpense: number }>(
      `SELECT
         strftime('%Y-%m', datetime(t.createdAt, '+8 hours')) as yearMonth,
         SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END) as totalIncome,
         SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END) as totalExpense
       FROM transactions t
       INNER JOIN ledgers l ON t.ledgerId = l.ledgerId
       WHERE l.userId = ? AND COALESCE(l.isArchived, 0) = 0 AND t.createdAt >= ?
       GROUP BY yearMonth
       ORDER BY yearMonth ASC`,
      [userId, startDate]
    );
    const dataMap = new Map(rows.map((r) => [r.yearMonth, r]));

    const result = [];
    for (let i = months - 1; i >= 0; i--) {
      let y = year, m = month - i;
      while (m <= 0) { m += 12; y--; }
      const key = `${y}-${String(m).padStart(2, '0')}`;
      const row = dataMap.get(key);
      result.push({
        year: y, month: m,
        label: `${y}/${String(m).padStart(2, '0')}`,
        totalIncome: row?.totalIncome || 0,
        totalExpense: row?.totalExpense || 0,
        balance: (row?.totalIncome || 0) - (row?.totalExpense || 0),
      });
    }
    res.json(result);
  }));

  // ── CSV export ────────────────────────────────────────────────────────────
  app.get('/api/export/csv', asyncHandler(async (req, res) => {
    const ledgerId = Number(req.query.ledgerId);
    if (Number.isNaN(ledgerId)) throw new Error('LEDGER_ID_REQUIRED');
    const { startDate, endDate } = parseDateRange(req);
    const transactions = await transactionModule.getTransactionsByLedgerAndDateRange(
      ledgerId, startDate, endDate, 10000
    );
    const escape = (s: string) => `"${String(s || '').replace(/"/g, '""')}"`;
    const rows = [
      ['時間', '類型', '金額', '類別', '子類別', '付款方式', '備註'].join(','),
      ...transactions.map((t) => [
        escape(String(t.createdAt)),
        t.type === 'income' ? '進帳' : '支出',
        t.amount,
        escape(t.category),
        escape(t.subcategory),
        escape(t.paymentMethod),
        escape(t.description || ''),
      ].join(',')),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send('﻿' + rows);
  }));

  const publicPath = path.resolve(process.cwd(), 'app/src/web/public');
  app.use(express.static(publicPath));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(publicPath, 'index.html')));

  app.listen(PORT, () => {
    console.log(`Local web dashboard running at http://localhost:${PORT}`);
  });
}

startWebServer().catch((err) => {
  console.error('Failed to start web dashboard:', err);
  process.exit(1);
});
