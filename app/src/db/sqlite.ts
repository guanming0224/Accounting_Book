import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export class Database {
  private db: sqlite3.Database;

  constructor() {
    const directory = path.dirname(config.database.path);
    if (directory && directory !== '.') {
      fs.mkdirSync(directory, { recursive: true });
    }

    this.db = new sqlite3.Database(config.database.path);
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('PRAGMA foreign_keys = ON', (err) => {
          if (err) reject(err);
        });

        // Users table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS users (
            userId INTEGER PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Ledgers table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS ledgers (
            ledgerId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            isArchived INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);
        this.db.run(`ALTER TABLE ledgers ADD COLUMN isArchived INTEGER DEFAULT 0`, () => {});

        // Transactions table
        this.db.run(`
          CREATE TABLE IF NOT EXISTS transactions (
            transactionId INTEGER PRIMARY KEY AUTOINCREMENT,
            ledgerId INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT NOT NULL,
            paymentMethod TEXT NOT NULL,
            description TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ledgerId) REFERENCES ledgers(ledgerId)
          )
        `);

        // User-configurable payment methods
        this.db.run(`
          CREATE TABLE IF NOT EXISTS payment_methods (
            paymentMethodId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(userId, name),
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // User-configurable income/expense categories
        this.db.run(`
          CREATE TABLE IF NOT EXISTS user_categories (
            categoryId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(userId, type, name),
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // User-configurable category children
        this.db.run(`
          CREATE TABLE IF NOT EXISTS user_subcategories (
            subcategoryId INTEGER PRIMARY KEY AUTOINCREMENT,
            categoryId INTEGER NOT NULL,
            name TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(categoryId, name),
            FOREIGN KEY (categoryId) REFERENCES user_categories(categoryId) ON DELETE CASCADE
          )
        `);

        // Latest user settings backup as a JSON snapshot
        this.db.run(`
          CREATE TABLE IF NOT EXISTS settings_backups (
            userId INTEGER PRIMARY KEY,
            snapshot TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Monthly category budgets
        this.db.run(`
          CREATE TABLE IF NOT EXISTS budgets (
            budgetId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            category TEXT NOT NULL,
            amount REAL NOT NULL,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(userId, category, year, month),
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Goals
        this.db.run(`
          CREATE TABLE IF NOT EXISTS goals (
            goalId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            targetAmount REAL NOT NULL,
            savedAmount REAL DEFAULT 0,
            deadline TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Accounts (bank, cash, credit card, investment)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS accounts (
            accountId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'bank',
            balance REAL DEFAULT 0,
            currency TEXT DEFAULT 'TWD',
            note TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Recurring transaction templates
        this.db.run(`
          CREATE TABLE IF NOT EXISTS recurring_transactions (
            recurringId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            ledgerId INTEGER NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('expense','income')),
            amount REAL NOT NULL,
            category TEXT NOT NULL,
            subcategory TEXT NOT NULL,
            paymentMethod TEXT NOT NULL,
            description TEXT DEFAULT '',
            dayOfMonth INTEGER DEFAULT 1,
            nextDate TEXT DEFAULT '',
            isActive INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId),
            FOREIGN KEY (ledgerId) REFERENCES ledgers(ledgerId)
          )
        `);

        // Bill reminders
        this.db.run(`
          CREATE TABLE IF NOT EXISTS bill_reminders (
            reminderId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            amount REAL DEFAULT 0,
            dueDay INTEGER NOT NULL,
            note TEXT DEFAULT '',
            isActive INTEGER DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Split bills
        this.db.run(`
          CREATE TABLE IF NOT EXISTS split_bills (
            splitId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            title TEXT NOT NULL,
            totalAmount REAL NOT NULL,
            note TEXT DEFAULT '',
            isSettled INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        this.db.run(`
          CREATE TABLE IF NOT EXISTS split_participants (
            participantId INTEGER PRIMARY KEY AUTOINCREMENT,
            splitId INTEGER NOT NULL,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            isPaid INTEGER DEFAULT 0,
            FOREIGN KEY (splitId) REFERENCES split_bills(splitId) ON DELETE CASCADE
          )
        `);

        // Transaction templates
        this.db.run(`
          CREATE TABLE IF NOT EXISTS transaction_templates (
            templateId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('expense','income')),
            ledgerId INTEGER NOT NULL,
            amount REAL DEFAULT 0,
            category TEXT NOT NULL DEFAULT '',
            subcategory TEXT NOT NULL DEFAULT '',
            paymentMethod TEXT NOT NULL DEFAULT '',
            description TEXT DEFAULT '',
            currency TEXT DEFAULT 'TWD',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // App config
        this.db.run(`
          CREATE TABLE IF NOT EXISTS app_config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Safe column migrations (silently ignore "column already exists")
        this.db.run(`ALTER TABLE transactions ADD COLUMN tags TEXT DEFAULT ''`, () => {});
        this.db.run(`ALTER TABLE transactions ADD COLUMN currency TEXT DEFAULT 'TWD'`, () => {});
        this.db.run(`ALTER TABLE accounts ADD COLUMN statementDay INTEGER DEFAULT 0`, () => {});
        this.db.run(`ALTER TABLE accounts ADD COLUMN paymentDay INTEGER DEFAULT 0`, () => {});
        this.db.run(`ALTER TABLE accounts ADD COLUMN creditLimit REAL DEFAULT 0`, () => {});

        // Create index for faster queries
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_ledger ON transactions(ledgerId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_ledgers_user ON ledgers(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_categories_user_type ON user_categories(userId, type)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_budgets_user ON budgets(userId, year, month)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_goals_user ON goals(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_recurring_user ON recurring_transactions(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_reminders_user ON bill_reminders(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_splits_user ON split_bills(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_templates_user ON transaction_templates(userId)`);

        // Net worth snapshots (daily)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS net_worth_snapshots (
            snapshotId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            totalAssets REAL NOT NULL DEFAULT 0,
            totalLiabilities REAL NOT NULL DEFAULT 0,
            netWorth REAL NOT NULL DEFAULT 0,
            recordedDate TEXT NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(userId, recordedDate),
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_net_worth_user ON net_worth_snapshots(userId, recordedDate)`);

        // Utility meters (water, electricity, gas)
        this.db.run(`
          CREATE TABLE IF NOT EXISTS utility_meters (
            meterId INTEGER PRIMARY KEY AUTOINCREMENT,
            userId INTEGER NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'electricity',
            unit TEXT NOT NULL DEFAULT '度',
            ratePerUnit REAL NOT NULL DEFAULT 0,
            baseCharge REAL DEFAULT 0,
            note TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

        // Utility meter readings
        this.db.run(`
          CREATE TABLE IF NOT EXISTS utility_readings (
            readingId INTEGER PRIMARY KEY AUTOINCREMENT,
            meterId INTEGER NOT NULL,
            reading REAL NOT NULL,
            readDate TEXT NOT NULL,
            note TEXT DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (meterId) REFERENCES utility_meters(meterId) ON DELETE CASCADE
          )
        `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_utility_meters_user ON utility_meters(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_utility_readings_meter ON utility_readings(meterId, readDate)`);

        this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_subcategories_category ON user_subcategories(categoryId)`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }

  run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) reject(err);
        // `this` is the sqlite3 RunResult, exposing lastID/changes for the statement.
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row as T);
      });
    });
  }

  all<T>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve((rows as T[]) || []);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

export const db = new Database();
