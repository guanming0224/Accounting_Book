# Telegram 記帳系統

一個基於 Telegram Bot 的完整端到端記帳系統，集成 Google Sheets 用於資料存儲。

## 功能特性

✨ **核心功能**
- 完整的記帳流程（進帳/支出）
- 多帳本支持（5個預設帳本）
- 六大分類系統（食、衣、住、行、育、樂）
- 靈活的支付方式支持
- Google Sheets 自動備份
- Redis 會話快取（低延遲）

🚀 **效能優化**
- 非阻塞 I/O 操作
- Redis 快取層（會話和帳本數據）
- 資料庫查詢優化和索引
- 批量寫入 Google Sheets API

## 系統架構

```
Telegram User ──► Telegram Bot (Node.js + TypeScript)
                        ↓
                  [Session Cache - Redis]
                        ↓
                  [User & Ledger Management]
                        ↓
                  [Google Sheets API]
                        ↓
                  [Local DB - SQLite]
```

## 環境要求

- Node.js 18.17.0+
- npm 9.6.7+
- Redis (用於會話快取)
- Telegram Bot Token
- Google Sheets API 認證文件 (可選)

## 快速開始

### 1. 安裝依賴

```bash
npm install
```

### 2. 配置環境變數

複製 `API/.env.example` 到 `API/.env` 並填入您的配置：

```bash
cp API/.env.example API/.env
```

編輯 `API/.env` 文件：

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
GOOGLE_SHEETS_CREDENTIALS=./json/credentials.json
GOOGLE_SHEETS_ID=your_sheet_id
REDIS_HOST=localhost
REDIS_PORT=6379
DB_PATH=./app/data/accounting.db
NODE_ENV=development
```

### 3. 取得 Telegram Bot Token

1. 在 Telegram 中搜尋 **@BotFather**
2. 發送 `/newbot` 命令
3. 按照指示建立您的 Bot
4. 複製生成的 Token

### 4. 設定 Google Sheets (可選)

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新專案並啟用 Google Sheets API
3. 建立服務帳號並下載 JSON 認證文件
4. 將認證文件保存到項目目錄

### 5. 運行 Bot

**開發模式：**
```bash
npm run dev
```

**編譯為 JavaScript：**
```bash
npm run build
npm start
```

## 使用說明

### 記帳流程

1. 向 Bot 發送 `/start` 或點擊 `記帳`
2. 選擇進出類型：**支出** 或 **進帳**
3. 選擇帳本：**帳本一** ~ **帳本五**
4. 選擇類別：**食、衣、住、行、育、樂**
5. 選擇子類別（依據所選分類）
6. 選擇支付方式：**現金、Line Pay、支付寶、信用卡**
7. 輸入金額
8. 完成！交易已記錄至本地資料庫和 Google Sheets

### 資料結構

#### 六大分類

| 類別 | 說明 | 子類別 |
|------|------|--------|
| 食 | 維持生命活動機能的能量提取 | 早餐、午餐、晚餐、消夜、飲料、餐飲、食材 |
| 衣 | 身體保護與社交禮儀 | 上衣、褲子、襪子、帽子、外套、鞋子、護具、飾品 |
| 住 | 安全、隱私與休息 | 房租、家具、水費、電費、瓦斯 |
| 行 | 位移與運輸 | 共車費、大眾交通、私車費 |
| 育 | 學習與培育 | 學費、書籍費、考試費 |
| 樂 | 休閒與體驗 | 旅遊、健身 |

## 項目結構

```
app/src/
├── bot/                 # Telegram Bot 核心
├── modules/
│   ├── user/            # 使用者管理
│   ├── ledger/          # 帳本管理
│   ├── transaction/     # 交易管理
│   └── category/        # 分類管理
├── integrations/
│   └── GoogleSheets.ts  # Google Sheets API 整合
├── db/
│   ├── sqlite.ts        # SQLite 連接
│   └── cache.ts         # Redis 快取
├── types/               # TypeScript 型別定義
├── handlers/            # Telegram 事件處理
└── main.ts              # 應用入口點
```

## 效能優化

### 1. **快速回應**
- 使用 Redis 快取會話狀態
- 預先載入用戶帳本數據
- 減少資料庫查詢次數

### 2. **非阻塞操作**
- 所有 I/O 操作都使用 async/await
- Google Sheets 寫入為後台異步操作
- 不會阻塞 Telegram 消息處理

### 3. **資料庫優化**
- SQLite 本地存儲快速查詢
- 建立索引加速查詢
- 預設分頁提取交易紀錄

### 4. **批量操作**
- 支持批量寫入 Google Sheets
- 減少 API 呼叫次數

## API 參考

### 使用者模組

```typescript
// 獲取或建立使用者
await userModule.getOrCreateUser(userId, username);

// 根據 ID 獲取使用者
await userModule.getUserByUserId(userId);
```

### 帳本模組

```typescript
// 為使用者建立預設帳本
await ledgerModule.createDefaultLedgers(userId);

// 獲取使用者的所有帳本
await ledgerModule.getUserLedgers(userId);
```

### 交易模組

```typescript
// 建立交易
await transactionModule.createTransaction(
  ledgerId,
  'expense',
  100,
  '食',
  '午餐',
  'cash',
  '備註'
);

// 獲取帳本交易紀錄
await transactionModule.getTransactionsByLedger(ledgerId);
```

## 故障排查

### Redis 連接失敗
```
⚠️  Failed to connect to Redis
```
確保 Redis 服務正在運行：
```bash
redis-server
```

### Google Sheets 認證失敗
```
⚠️  Google Sheets authentication failed
```
- 檢查認證文件路徑
- 驗證 Sheets API 已啟用
- 確認服務帳號有寫入權限

### Telegram Bot 無回應
```
❌ Failed to start bot: TELEGRAM_BOT_TOKEN is not set
```
確保 `TELEGRAM_BOT_TOKEN` 已正確設置

## 部署

### Docker 部署

```bash
docker build -t accounting-bot .
docker run -e TELEGRAM_BOT_TOKEN=xxx accounting-bot
```

### PM2 進程管理

```bash
pm2 start dist/main.js --name accounting-bot
pm2 save
pm2 startup
```

## 開發

### 運行測試
```bash
npm test
```

### 代碼格式化
```bash
npm run format
```

### Linting
```bash
npm run lint
```

## 貢獻

歡迎提交 Pull Request 或報告 Issue！

## 許可證

MIT

---

**祝您使用愉快！** 🎉

如有任何問題，請聯繫開發者或提交 Issue。
