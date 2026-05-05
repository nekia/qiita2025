# line-group-id-webhook

LINE Bot webhook を受け取り、`groupId` / `roomId` / `userId` を Cloud Logging に出力する一時調査用サービスです。

このサービスは「ID取得が終わったら削除する」運用を想定しています。

## 環境変数

- `LINE_CHANNEL_SECRET`（本番では必須）
- `SKIP_SIGNATURE_VALIDATION`（`true` は一時切り分け用）
- `PORT`（default: `8080`）

## ローカル実行

```bash
cd services/line-group-id-webhook
npm install
npm start
```

## 利用手順（Cloud Run）

### 1) デプロイ

```bash
gcloud run deploy line-group-id-webhook-dev \
  --source services/line-group-id-webhook \
  --region asia-northeast1 \
  --project line-msg-kiosk-board-dev \
  --allow-unauthenticated \
  --set-env-vars SKIP_SIGNATURE_VALIDATION=false \
  --set-secrets LINE_CHANNEL_SECRET=line_channel_secret:latest
```

### 2) URL確認と疎通確認

```bash
SERVICE_URL=$(gcloud run services describe line-group-id-webhook-dev \
  --region asia-northeast1 \
  --project line-msg-kiosk-board-dev \
  --format='value(status.url)')

echo "$SERVICE_URL"
curl -i "$SERVICE_URL/healthz"
```

`/healthz` は `200 ok` が期待値です。  
`/callback` を署名なしで叩くと `401 {"error":"missing_signature"}` になればアプリ到達は正常です。

```bash
curl -i -X POST "$SERVICE_URL/callback" \
  -H "Content-Type: application/json" \
  -d '{"events":[]}'
```

### 3) LINE Developers に Webhook URL を設定

以下のどちらかを設定します。

- `https://<cloud-run-url>/callback`
- `https://<cloud-run-url>/webhook/line`

Verify で `401` になる場合は、`LINE_CHANNEL_SECRET` のチャネル不一致が主因です。  
切り分け目的で一時的に `SKIP_SIGNATURE_VALIDATION=true` にして Verify を通しても構いません（取得後は必ず `false` に戻す）。

### 4) groupId を取得

- Bot を対象グループに招待
- グループ内で1回発話
- 次のコマンドでログ確認

```bash
gcloud logging read \
'resource.type="cloud_run_revision" AND resource.labels.service_name="line-group-id-webhook-dev" AND jsonPayload.message="line webhook received"' \
--project line-msg-kiosk-board-dev \
--limit 50 \
--format='value(jsonPayload.source_type,jsonPayload.group_id,jsonPayload.room_id,jsonPayload.user_id)'
```

`source_type=group` の行に出る `group_id` を利用します。

### 5) 取得後にサービス削除（推奨）

```bash
gcloud run services delete line-group-id-webhook-dev \
  --region asia-northeast1 \
  --project line-msg-kiosk-board-dev
```
