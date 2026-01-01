#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN=${SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN:-line_channel_access_token}
SECRET_NAME_LINE_CHANNEL_SECRET=${SECRET_NAME_LINE_CHANNEL_SECRET:-line_channel_secret}

gcloud run deploy kiosk-gateway \
    --source ./services/kiosk-gateway \
    --region $REGION \
    --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
    --update-secrets LINE_CHANNEL_ACCESS_TOKEN=$SECRET_NAME_LINE_CHANNEL_ACCESS_TOKEN:latest,LINE_CHANNEL_SECRET=$SECRET_NAME_LINE_CHANNEL_SECRET:latest \
    --no-allow-unauthenticated

KIOSK_GATEWAY_URL=$(gcloud run services describe kiosk-gateway --region $REGION --project $PROJECT_ID --format='value(status.url)')
echo "Kiosk Gateway URL: $KIOSK_GATEWAY_URL"