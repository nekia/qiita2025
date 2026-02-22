#!/usr/bin/env bash
set -euo pipefail

# ====== 設定（環境変数から読む）======
# 本番: 未設定または https://api.switch-bot.com
# 開発: ローカル Switchbot 互換 API（例: http://127.0.0.1:8080）
BASE="${SWITCHBOT_API_BASE:-https://api.switch-bot.com}"
SW_TOKEN="${SWITCHBOT_TOKEN:-}"
SW_SECRET="${SWITCHBOT_SECRET:-}"
# ===================================

# 本番 API のときだけトークン必須
if [[ "$BASE" == *"api.switch-bot.com"* ]]; then
  if [ -z "$SW_TOKEN" ] || [ -z "$SW_SECRET" ]; then
    echo "SWITCHBOT_TOKEN and SWITCHBOT_SECRET are required for production API" >&2
    exit 1
  fi
fi

req_headers() {
  [[ "$BASE" != *"api.switch-bot.com"* ]] && return 0
  local t nonce data sign
  t="$(python3 - <<'PY'
import time
print(int(time.time()*1000))
PY
)"
  nonce="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"
  data="${SW_TOKEN}${t}${nonce}"

  sign="$(python3 - <<PY
import base64, hmac, hashlib
token="${SW_TOKEN}"
secret="${SW_SECRET}"
data="${data}"
print(base64.b64encode(hmac.new(secret.encode(), data.encode(), hashlib.sha256).digest()).decode())
PY
)"

  cat <<EOF
Authorization: ${SW_TOKEN}
sign: ${sign}
t: ${t}
nonce: ${nonce}
Content-Type: application/json; charset=utf8
EOF
}

sb_get() {
  local path="$1"
  if [[ "$BASE" == *"api.switch-bot.com"* ]]; then
    local headers
    headers="$(req_headers)"
    curl -sS "${BASE}${path}" \
      -H "$(echo "$headers" | sed -n '1p')" \
      -H "$(echo "$headers" | sed -n '2p')" \
      -H "$(echo "$headers" | sed -n '3p')" \
      -H "$(echo "$headers" | sed -n '4p')" \
      -H "$(echo "$headers" | sed -n '5p')"
  else
    curl -sS "${BASE}${path}" -H "Content-Type: application/json"
  fi
}

sb_post() {
  local path="$1" body="$2"
  if [[ "$BASE" == *"api.switch-bot.com"* ]]; then
    local headers
    headers="$(req_headers)"
    curl -sS -X POST "${BASE}${path}" \
      -H "$(echo "$headers" | sed -n '1p')" \
      -H "$(echo "$headers" | sed -n '2p')" \
      -H "$(echo "$headers" | sed -n '3p')" \
      -H "$(echo "$headers" | sed -n '4p')" \
      -H "$(echo "$headers" | sed -n '5p')" \
      -d "$body"
  else
    curl -sS -X POST "${BASE}${path}" -H "Content-Type: application/json" -d "$body"
  fi
}

list_devices() {
  sb_get "/v1.1/devices"
}

cmd() {
  local deviceId="$1" command="$2" parameter="${3:-default}"
  sb_post "/v1.1/devices/${deviceId}/commands" \
    "$(printf '{"command":"%s","parameter":"%s","commandType":"command"}' "$command" "$parameter")"
}

# ---- 使い方の例 ----
# ./switchbot.sh devices
# ./switchbot.sh on  <deviceId>
# ./switchbot.sh off <deviceId>
# ./switchbot.sh bri <deviceId> 50
# ./switchbot.sh rgb <deviceId> 255:0:0

case "${1:-}" in
  devices) list_devices ;;
  on)  cmd "$2" "turnOn" "default" ;;
  off) cmd "$2" "turnOff" "default" ;;
  toggle) cmd "$2" "toggle" "default" ;;
  bri) cmd "$2" "setBrightness" "$3" ;;           # 0-100 :contentReference[oaicite:3]{index=3}
  rgb) cmd "$2" "setColor" "$3" ;;                # "R:G:B" :contentReference[oaicite:4]{index=4}
  cct) cmd "$2" "setColorTemperature" "$3" ;;     # 2700-6500 (対応モデルのみ) :contentReference[oaicite:5]{index=5}
  blink)
    deviceId="${2:-}"
    count="${3:-3}"
    interval_ms="${4:-400}"
    if [ -z "$deviceId" ]; then
      echo "deviceId is required for blink" >&2
      exit 1
    fi
    if ! [[ "$count" =~ ^[0-9]+$ ]]; then
      echo "count must be integer" >&2
      exit 1
    fi
    if ! [[ "$interval_ms" =~ ^[0-9]+$ ]]; then
      echo "interval_ms must be integer (ms)" >&2
      exit 1
    fi
    interval_sec="$(python3 - <<PY
ms = int("$interval_ms")
print(ms / 1000.0)
PY
)"
    for ((i = 0; i < count; i += 1)); do
      cmd "$deviceId" "turnOn" "default"
      sleep "$interval_sec"
      cmd "$deviceId" "turnOff" "default"
      sleep "$interval_sec"
    done
    ;;
  *) echo "Usage:
  $0 devices
  $0 on|off|toggle <deviceId>
  $0 bri <deviceId> <0-100>
  $0 rgb <deviceId> <R:G:B>
  $0 cct <deviceId> <2700-6500>   # 対応モデルのみ
  $0 blink <deviceId> [count] [interval_ms]
" >&2; exit 1 ;;
esac
