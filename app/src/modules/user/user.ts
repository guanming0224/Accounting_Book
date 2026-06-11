import { db } from '../../db/sqlite';
import { cacheManager } from '../../db/cache';
import { User } from '../../types';

export class UserModule {
  async getOrCreateUser(userId: number, username: string): Promise<User> {
    let user = await db.get<User>(
      'SELECT * FROM users WHERE userId = ?',
      [userId]
    );

    if (!user) {
      await db.run(
        'INSERT INTO users (userId, username) VALUES (?, ?)',
        [userId, username]
      );
      user = await db.get<User>(
        'SELECT * FROM users WHERE userId = ?',
        [userId]
      );
    }

    return user as User;
  }

  async getUserByUserId(userId: number): Promise<User | null> {
    const user = await db.get<User>(
      'SELECT * FROM users WHERE userId = ?',
      [userId]
    );
    return user || null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const user = await db.get<User>(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    return user || null;
  }
}

export const userModule = new UserModule();
