import { google } from 'googleapis';
import * as fs from 'fs';

/**
 * Google Sheets 初始化腳本
 * 用於建立記帳 Google Sheet 模板
 *
 * 使用方法：
 * 1. 設定 GOOGLE_SHEETS_CREDENTIALS 和 GOOGLE_SHEETS_ID
 * 2. 執行：npm run init:sheets
 */

async function initializeGoogleSheet() {
  try {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS || './json/credentials.json';
    const sheetsId = process.env.GOOGLE_SHEETS_ID;

    if (!sheetsId) {
      console.error('❌ GOOGLE_SHEETS_ID 未設定');
      process.exit(1);
    }

    if (!fs.existsSync(credentialsPath)) {
      console.error(`❌ 認證文件不存在: ${credentialsPath}`);
      process.exit(1);
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const authClient: any = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: authClient });

    console.log('📝 建立 Google Sheet 標題行...');

    const headers = [['時間', '類型', '類別', '子類別', '金額', '支付方式', '備註']];

    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetsId,
      range: 'Sheet1!A1:G1',
      valueInputOption: 'RAW',
      requestBody: { values: headers },
    });

    console.log('✅ Google Sheet 初始化成功！');
    console.log(`📊 Spreadsheet ID: ${sheetsId}`);
    console.log('您現在可以在此 Sheet 中查看所有交易記錄');
  } catch (error) {
    console.error('❌ 初始化失敗:', error);
    process.exit(1);
  }
}

initializeGoogleSheet();
