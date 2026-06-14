import { db } from '../../db/sqlite';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  PAYMENT_METHODS,
  CategoryDefinition,
} from '../../constants';
import { TransactionType } from '../../types';

interface CategoryRow {
  categoryId: number;
  userId: number;
  type: TransactionType;
  name: string;
  description: string;
}

interface SettingsSnapshot {
  paymentMethods: string[];
  categories: Record<TransactionType, CategoryDefinition[]>;
}

export class SettingsModule {
  async initializeDefaults(userId: number): Promise<void> {
    const paymentCount = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM payment_methods WHERE userId = ?',
      [userId]
    );
    if (!paymentCount?.count) {
      for (const name of Object.values(PAYMENT_METHODS)) {
        await db.run('INSERT OR IGNORE INTO payment_methods (userId, name) VALUES (?, ?)', [
          userId,
          name,
        ]);
      }
    }

    await this.initializeCategoryDefaults(userId, 'expense', EXPENSE_CATEGORIES);
    await this.initializeCategoryDefaults(userId, 'income', INCOME_CATEGORIES);
  }

  private async initializeCategoryDefaults(
    userId: number,
    type: TransactionType,
    categories: Record<string, CategoryDefinition>
  ): Promise<void> {
    const existing = await db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM user_categories WHERE userId = ? AND type = ?',
      [userId, type]
    );
    if (existing?.count) return;

    for (const category of Object.values(categories)) {
      const result = await db.run(
        'INSERT OR IGNORE INTO user_categories (userId, type, name, description) VALUES (?, ?, ?, ?)',
        [userId, type, category.name, category.description]
      );
      const categoryId =
        result.lastID ||
        (
          await db.get<CategoryRow>(
            'SELECT * FROM user_categories WHERE userId = ? AND type = ? AND name = ?',
            [userId, type, category.name]
          )
        )?.categoryId;

      if (!categoryId) continue;
      for (const subcategory of category.subcategories) {
        await db.run(
          'INSERT OR IGNORE INTO user_subcategories (categoryId, name) VALUES (?, ?)',
          [categoryId, subcategory]
        );
      }
    }
  }

  async backupSettings(userId: number): Promise<void> {
    const snapshot = await this.createSnapshot(userId);
    await db.run(
      `INSERT INTO settings_backups (userId, snapshot, updatedAt)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(userId) DO UPDATE SET
         snapshot = excluded.snapshot,
         updatedAt = CURRENT_TIMESTAMP`,
      [userId, JSON.stringify(snapshot)]
    );
  }

  async restoreBackup(userId: number): Promise<void> {
    const backup = await db.get<{ snapshot: string }>(
      'SELECT snapshot FROM settings_backups WHERE userId = ?',
      [userId]
    );
    if (!backup) {
      throw new Error('SETTINGS_BACKUP_NOT_FOUND');
    }

    await this.restoreSnapshot(userId, JSON.parse(backup.snapshot) as SettingsSnapshot);
  }

  async resetToDefaults(userId: number): Promise<void> {
    await this.backupSettings(userId);
    await this.restoreSnapshot(userId, {
      paymentMethods: Object.values(PAYMENT_METHODS),
      categories: {
        expense: Object.values(EXPENSE_CATEGORIES),
        income: Object.values(INCOME_CATEGORIES),
      },
    });
  }

  private async createSnapshot(userId: number): Promise<SettingsSnapshot> {
    await this.initializeDefaults(userId);
    return {
      paymentMethods: await this.getPaymentMethods(userId),
      categories: {
        expense: await this.getCategories(userId, 'expense'),
        income: await this.getCategories(userId, 'income'),
      },
    };
  }

  private async restoreSnapshot(userId: number, snapshot: SettingsSnapshot): Promise<void> {
    await this.clearSettings(userId);

    for (const paymentMethod of snapshot.paymentMethods) {
      await db.run('INSERT OR IGNORE INTO payment_methods (userId, name) VALUES (?, ?)', [
        userId,
        this.normalizeName(paymentMethod),
      ]);
    }

    for (const type of ['expense', 'income'] as TransactionType[]) {
      for (const category of snapshot.categories[type]) {
        const result = await db.run(
          'INSERT OR IGNORE INTO user_categories (userId, type, name, description) VALUES (?, ?, ?, ?)',
          [userId, type, this.normalizeName(category.name), category.description || '']
        );
        const categoryId =
          result.lastID ||
          (
            await db.get<CategoryRow>(
              'SELECT * FROM user_categories WHERE userId = ? AND type = ? AND name = ?',
              [userId, type, category.name]
            )
          )?.categoryId;

        if (!categoryId) continue;
        for (const subcategory of category.subcategories) {
          await db.run(
            'INSERT OR IGNORE INTO user_subcategories (categoryId, name) VALUES (?, ?)',
            [categoryId, this.normalizeName(subcategory)]
          );
        }
      }
    }
  }

  private async clearSettings(userId: number): Promise<void> {
    await db.run(
      `DELETE FROM user_subcategories
       WHERE categoryId IN (SELECT categoryId FROM user_categories WHERE userId = ?)`,
      [userId]
    );
    await db.run('DELETE FROM user_categories WHERE userId = ?', [userId]);
    await db.run('DELETE FROM payment_methods WHERE userId = ?', [userId]);
  }

  private normalizeName(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new Error('SETTING_NAME_EMPTY');
    if (normalized.length > 40) throw new Error('SETTING_NAME_TOO_LONG');
    return normalized;
  }

  async getPaymentMethods(userId: number): Promise<string[]> {
    await this.initializeDefaults(userId);
    const rows = await db.all<{ name: string }>(
      'SELECT name FROM payment_methods WHERE userId = ? ORDER BY paymentMethodId',
      [userId]
    );
    return rows.map((row) => row.name);
  }

  async addPaymentMethod(userId: number, name: string): Promise<void> {
    await db.run('INSERT INTO payment_methods (userId, name) VALUES (?, ?)', [
      userId,
      this.normalizeName(name),
    ]);
  }

  async renamePaymentMethod(userId: number, oldName: string, newName: string): Promise<void> {
    const result = await db.run(
      'UPDATE payment_methods SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ? AND name = ?',
      [this.normalizeName(newName), userId, oldName]
    );
    if (!result.changes) throw new Error('SETTING_NOT_FOUND');
  }

  async deletePaymentMethod(userId: number, name: string): Promise<void> {
    const result = await db.run('DELETE FROM payment_methods WHERE userId = ? AND name = ?', [
      userId,
      name,
    ]);
    if (!result.changes) throw new Error('SETTING_NOT_FOUND');
  }

  async getCategories(userId: number, type: TransactionType): Promise<CategoryDefinition[]> {
    await this.initializeDefaults(userId);
    const categories = await db.all<CategoryRow>(
      'SELECT * FROM user_categories WHERE userId = ? AND type = ? ORDER BY categoryId',
      [userId, type]
    );

    const result: CategoryDefinition[] = [];
    for (const category of categories) {
      const subcategories = await this.getSubcategories(userId, type, category.name);
      result.push({
        name: category.name,
        description: category.description || '',
        subcategories,
      });
    }
    return result;
  }

  async addCategory(userId: number, type: TransactionType, name: string): Promise<void> {
    await db.run(
      'INSERT INTO user_categories (userId, type, name, description) VALUES (?, ?, ?, ?)',
      [userId, type, this.normalizeName(name), '自訂類別']
    );
  }

  async renameCategory(
    userId: number,
    type: TransactionType,
    oldName: string,
    newName: string
  ): Promise<void> {
    const result = await db.run(
      'UPDATE user_categories SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ? AND type = ? AND name = ?',
      [this.normalizeName(newName), userId, type, oldName]
    );
    if (!result.changes) throw new Error('SETTING_NOT_FOUND');
  }

  async deleteCategory(userId: number, type: TransactionType, name: string): Promise<void> {
    const category = await this.getCategoryRow(userId, type, name);
    if (!category) throw new Error('SETTING_NOT_FOUND');

    await db.run('DELETE FROM user_subcategories WHERE categoryId = ?', [category.categoryId]);
    await db.run('DELETE FROM user_categories WHERE categoryId = ?', [category.categoryId]);
  }

  async getSubcategories(
    userId: number,
    type: TransactionType,
    categoryName: string
  ): Promise<string[]> {
    const category = await this.getCategoryRow(userId, type, categoryName);
    if (!category) return [];

    const rows = await db.all<{ name: string }>(
      'SELECT name FROM user_subcategories WHERE categoryId = ? ORDER BY subcategoryId',
      [category.categoryId]
    );
    return rows.map((row) => row.name);
  }

  async addSubcategory(
    userId: number,
    type: TransactionType,
    categoryName: string,
    name: string
  ): Promise<void> {
    const category = await this.getCategoryRow(userId, type, categoryName);
    if (!category) throw new Error('SETTING_NOT_FOUND');

    await db.run('INSERT INTO user_subcategories (categoryId, name) VALUES (?, ?)', [
      category.categoryId,
      this.normalizeName(name),
    ]);
  }

  async renameSubcategory(
    userId: number,
    type: TransactionType,
    categoryName: string,
    oldName: string,
    newName: string
  ): Promise<void> {
    const category = await this.getCategoryRow(userId, type, categoryName);
    if (!category) throw new Error('SETTING_NOT_FOUND');

    const result = await db.run(
      'UPDATE user_subcategories SET name = ?, updatedAt = CURRENT_TIMESTAMP WHERE categoryId = ? AND name = ?',
      [this.normalizeName(newName), category.categoryId, oldName]
    );
    if (!result.changes) throw new Error('SETTING_NOT_FOUND');
  }

  async deleteSubcategory(
    userId: number,
    type: TransactionType,
    categoryName: string,
    name: string
  ): Promise<void> {
    const category = await this.getCategoryRow(userId, type, categoryName);
    if (!category) throw new Error('SETTING_NOT_FOUND');

    const result = await db.run(
      'DELETE FROM user_subcategories WHERE categoryId = ? AND name = ?',
      [category.categoryId, name]
    );
    if (!result.changes) throw new Error('SETTING_NOT_FOUND');
  }

  private async getCategoryRow(
    userId: number,
    type: TransactionType,
    name: string
  ): Promise<CategoryRow | null> {
    const category = await db.get<CategoryRow>(
      'SELECT * FROM user_categories WHERE userId = ? AND type = ? AND name = ?',
      [userId, type, name]
    );
    return category || null;
  }
}

export const settingsModule = new SettingsModule();
