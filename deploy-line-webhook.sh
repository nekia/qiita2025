#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
PUBSUB_TOPIC=${PUBSUB_TOPIC:-kiosk-events}
DEVICE_ID=${DEVICE_ID:-home-parents-1}
LINE_IMAGE_BUCKET=${LINE_IMAGE_BUCKET:-kiosk-line-image}
LINE_IMAGE_PREFIX=${LINE_IMAGE_PREFIX:-line-images}
LINE_IMAGE_URL_TTL_HOURS=${LINE_IMAGE_URL_TTL_HOURS:-168}

gcloud run deploy line-webhook \
    --source ./line-webhook \
    --project $PROJECT_ID \
    --region $REGION \
    --set-env-vars PUBSUB_TOPIC=$PUBSUB_TOPIC,DEVICE_ID=$DEVICE_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
    --set-env-vars LINE_IMAGE_BUCKET=$LINE_IMAGE_BUCKET,LINE_IMAGE_PREFIX=$LINE_IMAGE_PREFIX,LINE_IMAGE_URL_TTL_HOURS=$LINE_IMAGE_URL_TTL_HOURS \
    --no-allow-unauthenticated

LINE_WEBHOOK_URL=$(gcloud run services describe line-webhook --region $REGION --project $PROJECT_ID --format='value(status.url)')
echo "Line Webhook URL: $LINE_WEBHOOK_URL"