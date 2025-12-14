## PoC: LINE → Pub/Sub → Firestore → SSE → Raspberry Pi

### ディレクトリ
- `services/dispatcher/` Pub/Sub push → Firestore upsert
- `services/kiosk-gateway/` Firestoreポーリング → SSE
- `raspi/local-proxy/` localhostでSSE中継（将来Bearer追加可）
- `web/` 最小UI（EventSourceで表示）

### 事前設定
```sh
PROJECT_ID=line-msg-kiosk-board
REGION=asia-northeast1
TOPIC=kiosk-events
SUB=kiosk-dispatcher-sub
PUBSUB_SA=pubsub-push@$PROJECT_ID.iam.gserviceaccount.com
```

### GCPリソース
```sh
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com pubsub.googleapis.com firestore.googleapis.com

# Firestore (Native)
gcloud alpha firestore databases create --location=$REGION --type=firestore-native

# Topic
gcloud pubsub topics create $TOPIC

# Push専用SA
gcloud iam service-accounts create pubsub-push --display-name="Pub/Sub push to dispatcher"
```

### dispatcher (Cloud Run)
```sh
gcloud run deploy dispatcher \
  --source ./services/dispatcher \
  --region $REGION \
  --no-allow-unauthenticated

DISPATCHER_URL=$(gcloud run services describe dispatcher --region $REGION --format='value(status.url)')

# Pub/Sub push subscription (OIDC)
gcloud pubsub subscriptions create $SUB \
  --topic $TOPIC \
  --push-endpoint="$DISPATCHER_URL/pubsub/push" \
  --push-auth-service-account=$PUBSUB_SA \
  --push-auth-token-audience="$DISPATCHER_URL/pubsub/push"
```
- Cloud Run Invoker に `serviceAccount:$PUBSUB_SA` を付与  
  `gcloud run services add-iam-policy-binding dispatcher --region $REGION --member=serviceAccount:$PUBSUB_SA --role=roles/run.invoker`

テスト publish（Pub/Subがbase64化しpush）
```sh
gcloud pubsub topics publish $TOPIC --message='{"eventId":"e1","deviceId":"home-parents-1","type":"line_message","occurredAt":"2025-12-13T00:00:00Z","payload":{"text":"hello from test","senderName":"tester"}}'
```
Firestore 確認: `devices/home-parents-1/events/e1` が upsert される。

### kiosk-gateway (Cloud Run)
```sh
gcloud run deploy kiosk-gateway \
  --source ./services/kiosk-gateway \
  --region $REGION \
  --no-allow-unauthenticated

KIOSK_URL=$(gcloud run services describe kiosk-gateway --region $REGION --format='value(status.url)')
# 必要に応じ Invoker を追加 (例: テスト用ユーザ/サービスアカウント)
```

SSE 疎通 (IDトークン付き)
```sh
TOKEN=$(gcloud auth print-identity-token --audiences=$KIOSK_URL)
curl -N -H "Authorization: Bearer $TOKEN" "$KIOSK_URL/sse?deviceId=home-parents-1&since=2025-12-13T00:00:00Z"
```
ハートビートが15–30秒ごとに出る。新規イベントで `event: kiosk_event` が流れる。

### ラズパイ local-proxy
```sh
cd raspi/local-proxy
TARGET_BASE=$KIOSK_URL PORT=8080 npm install
TARGET_BASE=$KIOSK_URL PORT=8080 node index.js
# ブラウザ: http://localhost:8080/ で EventSource が proxy 経由で接続
```
- 将来 `PROXY_BEARER_TOKEN` を設定すると Authorization ヘッダを付与して中継。

### フロー概要
1. line-webhook → Pub/Sub topic `kiosk-events`
2. Pub/Sub push (OIDC) → dispatcher `/pubsub/push`
3. dispatcher が Firestore `devices/{deviceId}/events/{eventId}` に set(merge) （payload.text が無ければ "(no text)"）
4. kiosk-gateway が Firestore をポーリングし SSE `/sse?deviceId=&since=` で配信（初回は直近20件、以降差分）
5. local-proxy が Cloud Run SSE を透過中継 → ブラウザの EventSource が表示

### エンドポイント仕様
- dispatcher: `POST /pubsub/push` (Pub/Sub push形式、message.data base64 JSON)
  - 必須: eventId, deviceId, type, payload.text（無い場合は "(no text)" で保存）
  - Firestore doc: createdAt(serverTimestamp), status=new, source=line, line{groupId,messageId,senderName}, occurredAtも保存
  - 成功: 204、バリデーションNG: 400、Firestore失敗: 500
- kiosk-gateway: `GET /sse?deviceId=...&since=...`
  - since: ISO8601 または epoch millis。未指定なら直近20件のみ→増分。
  - Heartbeat: `: heartbeat`
  - イベント: `event: kiosk_event`, `id: {eventId}`, `data: {json}`

### 最小E2E確認
1. 上記で Cloud Run 2サービスと Subscription を作成
2. `gcloud pubsub topics publish ...` でサンプル投入
3. `curl -N "$KIOSK_URL/sse?deviceId=home-parents-1"` で SSE を観測
4. ラズパイで proxy を起動し `http://localhost:8080/` をブラウザで開くと payload.text / senderName が反映

### 補足
- PORT 環境変数で listen（すべて対応済み）
- structured logging: eventId/deviceId を INFO/ERROR で出力
- 再接続: since をクエリに指定、ブラウザ側は localStorage に createdAt を保持