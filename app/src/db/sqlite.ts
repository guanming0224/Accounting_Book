import sqlite3 from 'sqlite3';
import path from 'path';
import { config } from '../config';

export class Database {
  private db: sqlite3.Database;

  constructor() {
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
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (userId) REFERENCES users(userId)
          )
        `);

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

        // Create index for faster queries
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_transactions_ledger ON transactions(ledgerId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_ledgers_user ON ledgers(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(userId)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_user_categories_user_type ON user_categories(userId, type)`);
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
