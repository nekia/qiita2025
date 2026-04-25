#!/bin/bash
# PC から ラズパイにファイルをコピーして pm2 を再起動するスクリプト
#
# 使い方:
#   ./deploy-to-pi.sh              # コード + web + photos + creds を同期して pm2 restart
#   ./deploy-to-pi.sh --code-only  # local-proxy + web のみ同期して pm2 restart
#   ./deploy-to-pi.sh --dry-run    # rsync を --dry-run で実行（実際にはコピーしない）

set -e

# ===== 引数パース =====
CODE_ONLY=false
DRY_RUN=""
for arg in "$@"; do
  case "$arg" in
    --code-only)  CODE_ONLY=true ;;
    --dry-run)    DRY_RUN="--dry-run" ;;
    -h|--help)
      sed -n '2,6p' "$0" | sed 's/^# *//'
      exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# ===== 設定 =====
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 呼び出し元の環境変数を退避（.env の export で上書きされるため）
_CALLER_RASPI_HOST="${RASPI_HOST:-}"
_CALLER_RASPI_BASE_DIR="${RASPI_BASE_DIR:-}"
_CALLER_RASPI_CREDS_DIR="${RASPI_CREDS_DIR:-}"

# raspi/.env からデフォルト値を読み込む
if [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck source=raspi/.env
  source "$SCRIPT_DIR/.env"
fi

# 呼び出し元で設定されていればそちらを優先
[ -n "$_CALLER_RASPI_HOST" ]     && RASPI_HOST="$_CALLER_RASPI_HOST"
[ -n "$_CALLER_RASPI_BASE_DIR" ] && RASPI_BASE_DIR="$_CALLER_RASPI_BASE_DIR"
[ -n "$_CALLER_RASPI_CREDS_DIR" ] && RASPI_CREDS_DIR="$_CALLER_RASPI_CREDS_DIR"

RASPI_HOST="${RASPI_HOST:-atsushi@192.168.3.22}"
RASPI_BASE_DIR="${RASPI_BASE_DIR:-/home/atsushi/kiosk}"
RASPI_CREDS_DIR="${RASPI_CREDS_DIR:-/opt/kiosk/creds}"

# pm2 プロセス名（ラズパイ側）
PM2_APP_NAME="${PM2_APP_NAME:-kiosk-local-proxy}"

echo "===================================="
echo "Deploying to Raspberry Pi"
echo "===================================="
echo "  RASPI_HOST:     $RASPI_HOST"
echo "  RASPI_BASE_DIR: $RASPI_BASE_DIR"
echo "  CODE_ONLY:      $CODE_ONLY"
echo "  DRY_RUN:        ${DRY_RUN:-no}"
echo ""

# ===== 1. ラズパイ上にディレクトリ作成 =====
echo "[1/6] Creating directories on Raspberry Pi..."
ssh "$RASPI_HOST" "mkdir -p $RASPI_BASE_DIR/raspi/local-proxy $RASPI_BASE_DIR/web $RASPI_BASE_DIR/photos"

# ===== 2. local-proxy のコードをコピー =====
echo "[2/6] Syncing local-proxy code..."
rsync -av --delete $DRY_RUN \
  --exclude="node_modules" \
  --exclude=".env" \
  "$PROJECT_ROOT/raspi/local-proxy/" \
  "$RASPI_HOST:$RASPI_BASE_DIR/raspi/local-proxy/"

# ===== 3. web のファイルをコピー =====
echo "[3/6] Syncing web files..."
rsync -av --delete $DRY_RUN \
  "$PROJECT_ROOT/web/" \
  "$RASPI_HOST:$RASPI_BASE_DIR/web/"

if [ "$CODE_ONLY" = false ]; then
  # ===== 4. photos のファイルをコピー =====
  echo "[4/6] Syncing photos..."
  rsync -av --delete $DRY_RUN \
    "$PROJECT_ROOT/photos/" \
    "$RASPI_HOST:$RASPI_BASE_DIR/photos/"

  # ===== 5. SA キーをコピー（credentials/ 配下） =====
  echo "[5/6] Copying service account keys..."
  SA_KEY="$PROJECT_ROOT/credentials/line-msg-kiosk-board-4ceb85a1da55-kiosk-tester.json"
  if [ -f "$SA_KEY" ]; then
    ssh "$RASPI_HOST" "sudo mkdir -p $RASPI_CREDS_DIR && sudo chown \$(whoami):\$(whoami) $RASPI_CREDS_DIR"
    scp "$SA_KEY" "$RASPI_HOST:$RASPI_CREDS_DIR/kiosk-tester.json"
    echo "  ✓ kiosk-tester.json"
  else
    echo "  ⚠ kiosk-tester.json not found locally (skipped)"
  fi
else
  echo "[4/6] Skipped (--code-only)"
  echo "[5/6] Skipped (--code-only)"
fi

# ===== 6. npm install + pm2 再起動 =====
echo "[6/6] Installing deps & restarting pm2..."
if [ -z "$DRY_RUN" ]; then
  ssh "$RASPI_HOST" bash -s -- "$RASPI_BASE_DIR" "$PM2_APP_NAME" <<'REMOTE'
    set -e
    BASE_DIR="$1"
    APP_NAME="$2"
    cd "$BASE_DIR/raspi/local-proxy"

    # 依存関係が変わっていれば更新
    npm install --production 2>&1 | tail -3

    # pm2 で管理されていれば restart、なければ新規起動
    if pm2 describe "$APP_NAME" > /dev/null 2>&1; then
      pm2 restart "$APP_NAME"
      echo "✓ pm2 restart $APP_NAME"
    else
      echo "⚠ pm2 process '$APP_NAME' not found. Starting new..."
      pm2 start ./start-proxy.sh --name "$APP_NAME" --interpreter bash
      pm2 save
      echo "✓ pm2 start $APP_NAME"
    fi
    pm2 status "$APP_NAME"
REMOTE
else
  echo "  (skipped — dry-run)"
fi

echo ""
echo "===================================="
echo "Deploy complete!"
echo "===================================="
echo "  Verify: ssh $RASPI_HOST pm2 logs $PM2_APP_NAME --lines 20"
echo "  Health: curl http://$(echo $RASPI_HOST | cut -d@ -f2):8080/healthz"
echo "===================================="
