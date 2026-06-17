import { google } from 'googleapis';
import * as fs from 'fs';
import { config } from '../config';
import { Transaction } from '../types';

export class GoogleSheetsIntegration {
  private sheets: any;
  private sheetsId: string;
  private enabled = false;

  constructor() {
    this.sheetsId = config.google.sheetsId;
    this.sheets = google.sheets('v4');
  }

  // True only after a successful authenticate() with both credentials and
  // a sheet id configured. While disabled, all writes become no-ops so local
  // testing runs without Google Sheets.
  isEnabled(): boolean {
    return this.enabled;
  }

  private isConfigured(): boolean {
    return Boolean(config.google.credentialsPath && config.google.sheetsId);
  }

  // SQLite CURRENT_TIMESTAMP yields a UTC string like "2026-06-11 08:55:00"
  // (no timezone marker). Normalize it to ISO-UTC so Date parses it as UTC,
  // then render in Taiwan local time.
  private formatTimestamp(createdAt: Date | string): string {
    let date: Date;
    if (typeof createdAt === 'string') {
      const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T');
      date = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
    } else {
      date = createdAt;
    }
    return date.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
  }

  async authenticate(): Promise<void> {
    // Not configured (e.g. local testing) — skip cleanly instead of erroring.
    if (!this.isConfigured()) {
      console.log('ℹ️  Google Sheets not configured, running in local-only mode');
      this.enabled = false;
      return;
    }

    try {
      const credentialsPath = config.google.credentialsPath;
      const content = fs.readFileSync(credentialsPath, 'utf-8');
      const credentials = JSON.parse(content);

      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient: any = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });
      this.enabled = true;
    } catch (error) {
      console.error('Failed to authenticate with Google Sheets:', error);
      throw error;
    }
  }

  async appendTransaction(transaction: Transaction): Promise<void> {
    if (!this.enabled) return;
    try {
      const values = [
        [
          this.formatTimestamp(transaction.createdAt),
          transaction.type === 'income' ? '進帳' : '支出',
          transaction.category,
          transaction.subcategory,
          transaction.amount,
          transaction.paymentMethod,
          transaction.description || '',
        ],
      ];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetsId,
        range: 'Sheet1!A:G',
        valueInputOption: 'RAW',
        requestBody: { values },
      });
    } catch (error) {
      console.error('Failed to append transaction to Google Sheets:', error);
      throw error;
    }
  }

  async appendMultipleTransactions(transactions: Transaction[]): Promise<void> {
    if (!this.enabled) return;
    const values = transactions.map((t) => [
      this.formatTimestamp(t.createdAt),
      t.type === 'income' ? '進帳' : '支出',
      t.category,
      t.subcategory,
      t.amount,
      t.paymentMethod,
      t.description || '',
    ]);

    try {
      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.sheetsId,
        range: 'Sheet1!A:G',
        valueInputOption: 'RAW',
        requestBody: { values },
      });
    } catch (error) {
      console.error('Failed to batch append transactions:', error);
      throw error;
    }
  }

  async getTransactionCount(): Promise<number> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.sheetsId,
        range: 'Sheet1!A:A',
      });

      return (response.data.values?.length || 0) - 1; // Exclude header
    } catch (error) {
      console.error('Failed to get transaction count:', error);
      return 0;
    }
  }
}

export const googleSheetsIntegration = new GoogleSheetsIntegration();
