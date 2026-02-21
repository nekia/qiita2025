#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
SERVICE_NAME=${SERVICE_NAME:-line-webhook}
SERVICE_ACCOUNT_EMAIL=${SERVICE_ACCOUNT_EMAIL:-}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
PUBSUB_TOPIC=${PUBSUB_TOPIC:-kiosk-events}
DEVICE_ID=${DEVICE_ID:-home-parents-1}
LINE_IMAGE_BUCKET=${LINE_IMAGE_BUCKET:-kiosk-line-image}
LINE_IMAGE_PREFIX=${LINE_IMAGE_PREFIX:-line-images}
LINE_IMAGE_URL_TTL_HOURS=${LINE_IMAGE_URL_TTL_HOURS:-168}

DEPLOY_ARGS=(
  --source ./line-webhook
  --project "$PROJECT_ID"
  --region "$REGION"
  --set-env-vars "PUBSUB_TOPIC=$PUBSUB_TOPIC,DEVICE_ID=$DEVICE_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID"
  --set-env-vars "LINE_IMAGE_BUCKET=$LINE_IMAGE_BUCKET,LINE_IMAGE_PREFIX=$LINE_IMAGE_PREFIX,LINE_IMAGE_URL_TTL_HOURS=$LINE_IMAGE_URL_TTL_HOURS"
  --no-allow-unauthenticated
)

if [ -n "$SERVICE_ACCOUNT_EMAIL" ]; then
  DEPLOY_ARGS+=(--service-account "$SERVICE_ACCOUNT_EMAIL")
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

LINE_WEBHOOK_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Line Webhook URL: $LINE_WEBHOOK_URL"