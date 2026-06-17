# 快速啟動指南

歡迎使用 Telegram 記帳系統！本指南將幫助您在 5 分鐘內啟動並運行此系統。

## 前置準備

✅ **系統要求**
- Windows / macOS / Linux
- Node.js 18.17.0+
- Redis (可選，用於會話快取)
- Telegram 帳號

## 步驟 1: 取得 Telegram Bot Token

1. 打開 Telegram 並搜尋 **@BotFather**
2. 發送命令 `/newbot`
3. 按照指示命名您的 Bot（例如：`MyAccountingBot`）
4. BotFather 將生成一個 **Token**（類似於 `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`）
5. 複製此 Token

## 步驟 2: 克隆或下載項目

如果您還未下載項目，請執行：

```bash
cd /path/to/Accounting_Book
```

## 步驟 3: 配置環境變數

複製範本文件並編輯：

```bash
cp API/.env.example API/.env
```

使用任何文本編輯器打開 `API/.env` 文件，填入您的 Token：

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
NODE_ENV=development
REDIS_HOST=localhost
REDIS_PORT=6379
DB_PATH=./app/data/accounting.db
```

## 步驟 4: 啟動 Redis（可選但推薦）

如果您已安裝 Redis，開啟新的終端並運行：

```bash
redis-server
```

如果未安裝，系統將在禁用快取的情況下運行（效能略低）。

## 步驟 5: 安裝依賴並啟動

回到項目目錄，運行：

```bash
npm install
npm run dev
```

如果一切順利，您將看到：

```
🚀 Starting Telegram Accounting Bot...
📊 Initializing database...
⚡ Connecting to Redis...
🤖 Starting Telegram Bot...
✅ Accounting Bot is running!
```

## 步驟 6: 開始使用

在 Telegram 中搜尋您的 Bot 名稱，然後：

1. 發送 `/start` 開始
2. 點擊 `記帳` 開始記錄交易
3. 按照提示完成記帳流程

### 記帳流程

```
記帳 → 選擇進出 → 選擇帳本 → 選擇類別 → 選擇子類別 → 選擇支付方式 → 輸入金額 → 完成 ✓
```

## 常見問題

### Q1: "TELEGRAM_BOT_TOKEN is not set" 錯誤

**A:** 檢查 `API/.env` 文件中是否正確設置了 `TELEGRAM_BOT_TOKEN`。

```bash
cat API/.env | grep TELEGRAM_BOT_TOKEN
```

### Q2: Redis 連接失敗

**A:** 如果未使用 Redis，系統仍可運行，但會話管理會降級。若要啟用快取，請：

- **macOS/Linux:**
  ```bash
  brew install redis
  redis-server
  ```

- **Windows:**
  下載 [Redis for Windows](https://github.com/microsoftarchive/redis/releases)

### Q3: Bot 沒有回應

**A:** 確保：
1. Bot Token 正確無誤
2. 網絡連接正常
3. 在終端中查看錯誤消息：`npm run dev`

### Q4: 如何使用 Google Sheets？

**A:** （可選功能）

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 建立新專案
3. 啟用 Google Sheets API
4. 建立服務帳號並下載 JSON 認證文件
5. 將文件保存為 `json/credentials.json`
6. 在 `API/.env` 中設置：
   ```env
   GOOGLE_SHEETS_CREDENTIALS=./json/credentials.json
   GOOGLE_SHEETS_ID=your_spreadsheet_id
   ```

## 生產部署

### 使用 Docker

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 使用 PM2

```bash
npm run build
pm2 start dist/main.js --name accounting-bot
pm2 save
pm2 startup
```

## 數據備份

您的所有數據都保存在 `./app/data/accounting.db`。定期備份此文件：

```bash
cp ./app/data/accounting.db ./app/data/accounting.db.backup.$(date +%Y%m%d)
```

## 下一步

- 📚 閱讀完整 [README.md](README.md)
- 🛠️ 配置 Google Sheets 以實現自動備份
- 📊 設計您的 Google Sheet 模板
- 🚀 部署到雲端服務器

## 獲取幫助

如有問題，請：

1. 檢查 [README.md](README.md) 的故障排查部分
2. 查看終端日誌（執行 `npm run dev` 時的輸出）
3. 驗證環境變數是否正確

---

祝您使用愉快！🎉

歡迎分享您的反饋和建議！
