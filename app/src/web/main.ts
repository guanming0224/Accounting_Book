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
