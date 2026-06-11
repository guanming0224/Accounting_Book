#!/bin/bash

# Telegram Accounting Bot - 快速設置指南
cd "$(dirname "$0")/.." || exit 1

echo "🚀 Telegram 記帳系統 - 設置向導"
echo "=================================="
echo ""

# 檢查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安裝。請先安裝 Node.js 18.17.0 或更高版本"
    exit 1
fi

echo "✅ Node.js 已安裝: $(node --version)"
echo ""

# 檢查 Redis
if ! command -v redis-cli &> /dev/null; then
    echo "⚠️  Redis 未檢測到，會話快取功能將無法正常工作"
    echo "   請安裝 Redis: https://redis.io/download"
fi

echo ""
echo "📦 安裝依賴..."
npm install

echo ""
echo "⚙️  配置環境變數..."
if [ ! -f API/.env ]; then
    cp API/.env.example API/.env
    echo "✅ 已創建 API/.env 文件，請編輯以添加您的配置："
    echo "   - TELEGRAM_BOT_TOKEN"
    echo "   - GOOGLE_SHEETS_CREDENTIALS (可選)"
    echo "   - REDIS_HOST 和 REDIS_PORT"
else
    echo "✅ API/.env 文件已存在"
fi

echo ""
echo "🔨 編譯 TypeScript..."
npm run build

echo ""
echo "✨ 設置完成！"
echo ""
echo "📝 後續步驟:"
echo "1. 編輯 API/.env 文件，填入您的 Telegram Bot Token"
echo "2. (可選) 配置 Google Sheets 認證文件"
echo "3. 確保 Redis 服務正在運行"
echo "4. 運行 Bot:"
echo "   npm run dev      # 開發模式"
echo "   npm start        # 生產模式"
echo ""
