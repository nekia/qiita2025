#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
SERVICE_NAME=${SERVICE_NAME:-kiosk-gateway}
SERVICE_ACCOUNT_EMAIL=${SERVICE_ACCOUNT_EMAIL:-}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN=${SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN:-line_channel_access_token}
SECRET_NAME_LINE_CHANNEL_SECRET=${SECRET_NAME_LINE_CHANNEL_SECRET:-line_channel_secret}

DEPLOY_ARGS=(
  --source ./services/kiosk-gateway
  --project "$PROJECT_ID"
  --region "$REGION"
  --set-env-vars "FIRESTORE_PROJECT_ID=$PROJECT_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID"
  --update-secrets "LINE_CHANNEL_ACCESS_TOKEN=$SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN:latest,LINE_CHANNEL_SECRET=$SECRET_NAME_LINE_CHANNEL_SECRET:latest"
  --no-allow-unauthenticated
)

if [ -n "$SERVICE_ACCOUNT_EMAIL" ]; then
  DEPLOY_ARGS+=(--service-account "$SERVICE_ACCOUNT_EMAIL")
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

KIOSK_GATEWAY_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Kiosk Gateway URL: $KIOSK_GATEWAY_URL"