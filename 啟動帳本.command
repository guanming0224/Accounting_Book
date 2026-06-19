#!/bin/bash
# 雙擊此檔案即可啟動帳本系統

cd "$(dirname "$0")"

echo "=============================="
echo "  Accounting Book 啟動中..."
echo "=============================="
echo ""

# 檢查 Node.js
if ! command -v node &>/dev/null; then
  echo "❌ 找不到 Node.js，請先安裝 Node.js 18+"
  read -p "按 Enter 關閉"
  exit 1
fi

# 安裝依賴（若 node_modules 不存在）
if [ ! -d "node_modules" ]; then
  echo "📦 首次使用，安裝依賴中..."
  npm install
fi

# Build TypeScript
echo "🔨 編譯中..."
npm run build 2>&1
if [ $? -ne 0 ]; then
  echo ""
  echo "❌ 編譯失敗，請檢查錯誤訊息"
  read -p "按 Enter 關閉"
  exit 1
fi

echo ""
echo "✅ 啟動成功！"
echo "🌐 網址：http://localhost:3000"
echo ""

# 等一秒再開瀏覽器，讓 server 先起來
(sleep 1.5 && open "http://localhost:3000") &

# 啟動 Web Server
npm run web
