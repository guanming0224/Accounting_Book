# 帳本 — 個人記帳 Web App

全端個人財務管理系統，PWA + 離線可用，支援深色模式。

## 技術棧

| 層級 | 技術 |
|------|------|
| 後端 | Node.js + TypeScript + Express 5 |
| 資料庫 | SQLite（sqlite3） |
| 前端 | 原生 HTML / CSS / JS（無框架） |
| 圖表 | Chart.js 4.4 |
| PWA | manifest.json + Service Worker |

## 功能

**帳務核心**
- 多帳本管理、帳戶轉帳
- 交易新增 / 編輯 / 刪除，支援六大分類與子分類
- 收據照片上傳（Base64，Canvas 壓縮）
- 定期交易自動套用（每小時背景執行）
- 商家記憶（輸入描述自動填入上次記錄）

**報表與分析**
- 月報 / 自訂日期範圍報告 / 年度報告（12 月長條圖）
- 記帳月曆（每日收支概覽）
- 全域搜尋（⌘F，模糊比對描述、分類、金額）
- 淨資產歷史折線圖（最近 90 天）
- 消費預測（3 個月日均 × 剩餘天數）
- 連續記帳天數（Streak，🔥 7 天以上特效）

**多幣別**
- frankfurter.app 即時匯率（24h 快取）
- 非 TWD 帳戶顯示台幣約當值

**預算**
- 分類預算設定，超支彈出 Toast 警示

**安全**
- SHA-256 PIN 雜湊，Bearer Token 驗證
- 所有 API 路由加 `requireAuth()` 中介層

## 快速啟動

```bash
npm install
npm run dev:web       # 開發模式（ts-node）
# 或
npm run build && npm run web   # 編譯後執行
```

預設監聽 `http://localhost:3000`

## 目錄結構

```
app/src/
├── db/sqlite.ts          # 資料庫初始化與 wrapper
├── modules/              # transaction / ledger / user / category
└── web/
    ├── main.ts           # Express server + 所有 API 路由
    └── public/
        ├── index.html
        ├── app.js        # 前端邏輯（~3000 行）
        ├── styles.css
        ├── manifest.json
        └── sw.js         # Service Worker
```

## 版本紀錄

| Tag | 內容 |
|-----|------|
| v0.4.3 | 水電度數追蹤 |
| v0.4.1 | 水電 API |
| v0.4.0 | Auth UI、範本、批次操作、洞察、通知、備份還原、匯率 |
| v0.3.7 | 同上（前端） |
