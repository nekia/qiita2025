# line-group-id-webhook

LINE Bot webhook events and logs `groupId` / `roomId` / `userId` to Cloud Logging.

## Environment variables

- `LINE_CHANNEL_SECRET` (required in production)
- `SKIP_SIGNATURE_VALIDATION` (`true` only for local debug)
- `PORT` (default: `8080`)

## Local run

```bash
cd services/line-group-id-webhook
npm install
npm start
```

## Cloud Run deploy example

```bash
gcloud run deploy line-group-id-webhook-dev \
  --source services/line-group-id-webhook \
  --region asia-northeast1 \
  --project line-msg-kiosk-board-dev \
  --allow-unauthenticated \
  --set-env-vars SKIP_SIGNATURE_VALIDATION=false \
  --set-secrets LINE_CHANNEL_SECRET=line_channel_secret:latest
```

## Set LINE webhook URL

Set LINE Developers webhook URL to one of:

- `https://<cloud-run-url>/callback`
- `https://<cloud-run-url>/webhook/line`

## Query logs for groupId

```bash
gcloud logging read \
'resource.type="cloud_run_revision" AND resource.labels.service_name="line-group-id-webhook-dev" AND jsonPayload.message="line webhook received"' \
--project line-msg-kiosk-board-dev \
--limit 50 \
--format='value(jsonPayload.source_type,jsonPayload.group_id,jsonPayload.room_id,jsonPayload.user_id)'
```
