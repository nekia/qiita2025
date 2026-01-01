#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
SECRET_NAME=${SECRET_NAME:-gemini-api-key}

gcloud run deploy dispatcher \
    --source ./services/dispatcher \
    --region $REGION \
    --set-env-vars FIRESTORE_PROJECT_ID=$PROJECT_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID \
    --update-secrets=GEMINI_API_KEY=$SECRET_NAME:latest \
    --no-allow-unauthenticated

DISPATCHER_URL=$(gcloud run services describe dispatcher --region $REGION --project $PROJECT_ID --format='value(status.url)')
echo "Dispatcher URL: $DISPATCHER_URL"