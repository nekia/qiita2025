#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
PUBSUB_TOPIC=${PUBSUB_TOPIC:-kiosk-events}
DEVICE_ID=${DEVICE_ID:-home-parents-1}

gcloud run deploy line-webhook \
    --source ./line-webhook \
    --project $PROJECT_ID \
    --region $REGION \
    --set-env-vars PUBSUB_TOPIC=$PUBSUB_TOPIC,DEVICE_ID=$DEVICE_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
    --no-allow-unauthenticated

LINE_WEBHOOK_URL=$(gcloud run services describe line-webhook --region $REGION --project $PROJECT_ID --format='value(status.url)')
echo "Line Webhook URL: $LINE_WEBHOOK_URL"