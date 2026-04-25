#!/bin/bash
# PC から ラズパイにファイルをコピーするスクリプト

set -e

# ===== 設定 =====
RASPI_HOST="${RASPI_HOST:-pi@raspberrypi.local}"
RASPI_BASE_DIR="${RASPI_BASE_DIR:-/home/pi/kiosk}"
RASPI_CREDS_DIR="${RASPI_CREDS_DIR:-/opt/kiosk/creds}"
PIUSER="${PIUSER:-atsushi}"

# ローカルのディレクトリパス（このスクリプトの位置から相対）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "===================================="
echo "Deploying to Raspberry Pi"
echo "===================================="
echo "RASPI_HOST: $RASPI_HOST"
echo "RASPI_BASE_DIR: $RASPI_BASE_DIR"
echo "RASPI_CREDS_DIR: $RASPI_CREDS_DIR"
echo "PROJECT_ROOT: $PROJECT_ROOT"
echo ""

# ===== 1. ラズパイ上にディレクトリ作成 =====
echo "[1/5] Creating directories on Raspberry Pi..."
ssh "$RASPI_HOST" "mkdir -p $RASPI_BASE_DIR/raspi/local-proxy $RASPI_BASE_DIR/web $RASPI_BASE_DIR/photos"
ssh "$RASPI_HOST" "sudo mkdir -p $RASPI_CREDS_DIR && sudo chown $PIUSER:$PIUSER $RASPI_CREDS_DIR"

# ===== 2. local-proxy のコードをコピー =====
echo "[2/5] Copying local-proxy code..."
rsync -av --delete \
  "$PROJECT_ROOT/raspi/local-proxy/" \
  "$RASPI_HOST:$RASPI_BASE_DIR/raspi/local-proxy/" \
  --exclude="node_modules"

# ===== 3. web のファイルをコピー =====
echo "[3/4] Copying web files..."
rsync -av --delete \
  "$PROJECT_ROOT/web/" \
  "$RASPI_HOST:$RASPI_BASE_DIR/web/"

# ===== 4. photos のファイルをコピー =====
echo "[4/5] Copying photos..."
rsync -av --delete \
  "$PROJECT_ROOT/photos/" \
  "$RASPI_HOST:$RASPI_BASE_DIR/photos/"

# ===== 5. SA キーをコピー（credentials/ 配下） =====
echo "[5/5] Copying service account keys..."
if [ -f "$PROJECT_ROOT/credentials/line-msg-kiosk-board-4ceb85a1da55-kiosk-tester.json" ]; then
  scp "$PROJECT_ROOT/credentials/line-msg-kiosk-board-4ceb85a1da55-kiosk-tester.json" \
    "$RASPI_HOST:$RASPI_CREDS_DIR/kiosk-tester.json"
  echo "  ✓ kiosk-tester.json"
else
  echo "  ⚠ kiosk-tester.json not found (skipped)"
fi

echo ""
echo "===================================="
echo "Deploy complete!"
echo "===================================="
echo "Next steps:"
echo "  1. SSH into Raspberry Pi:"
echo "     ssh $RASPI_HOST"
echo ""
echo "  2. Update start-proxy.sh env vars if needed:"
echo "     nano $RASPI_BASE_DIR/raspi/local-proxy/start-proxy.sh"
echo ""
echo "  3. Run the proxy:"
echo "     cd $RASPI_BASE_DIR/raspi/local-proxy"
echo "     ./start-proxy.sh"
echo ""
echo "  4. Open browser:"
echo "     http://<raspi-ip>:8080/"
echo "===================================="
