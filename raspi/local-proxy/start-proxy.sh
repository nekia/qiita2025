#!/usr/bin/bash
# ラズパイ上でローカルプロキシを起動するスクリプト

set -e

source .env

# ===== 環境変数設定 =====
# Cloud Run URLs
export TARGET_BASE="${TARGET_BASE:-https://kiosk-gateway-h3bva5byfq-an.a.run.app}"

# サービスアカウントキーのパス（ラズパイ上のローカルファイルシステム）
export KIOSK_SA_KEY_PATH="${KIOSK_SA_KEY_PATH:-/opt/kiosk/creds/kiosk-tester.json}"

# リスンポート
export PORT="${PORT:-8080}"

# トークンキャッシュ設定（オプション）
# export TOKEN_TTL_MS=3000000  # 50分（デフォルト）
# export TOKEN_MARGIN_MS=60000  # 1分（デフォルト）

# ===== 起動前チェック =====
echo "Starting local-proxy..."
echo "  TARGET_BASE: $TARGET_BASE"
echo "  KIOSK_SA_KEY_PATH: $KIOSK_SA_KEY_PATH"
echo "  PORT: $PORT"

# キーファイル存在確認
if [ ! -f "$KIOSK_SA_KEY_PATH" ]; then
  echo "ERROR: KIOSK_SA_KEY_PATH not found: $KIOSK_SA_KEY_PATH"
  exit 1
fi

# 依存関係インストール（初回のみ）
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# プロキシ起動
echo "Listening on http://localhost:$PORT"
exec node index.js
