#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
SERVICE_NAME=${SERVICE_NAME:-dispatcher}
SERVICE_ACCOUNT_EMAIL=${SERVICE_ACCOUNT_EMAIL:-}
FIRESTORE_DATABASE_ID=${FIRESTORE_DATABASE_ID:-line-msg-store}
SECRET_NAME=${SECRET_NAME:-gemini-api-key}
PUBSUB_TOPIC=${PUBSUB_TOPIC:-kiosk-events}
PUBSUB_SUBSCRIPTION=${PUBSUB_SUBSCRIPTION:-kiosk-events-dispatcher}

DEPLOY_ARGS=(
  --source ./services/dispatcher
  --project "$PROJECT_ID"
  --region "$REGION"
  --set-env-vars "FIRESTORE_PROJECT_ID=$PROJECT_ID,FIRESTORE_DATABASE_ID=$FIRESTORE_DATABASE_ID"
  --update-secrets "GEMINI_API_KEY=$SECRET_NAME:latest"
  --allow-unauthenticated
)

if [ -n "$SERVICE_ACCOUNT_EMAIL" ]; then
  DEPLOY_ARGS+=(--service-account "$SERVICE_ACCOUNT_EMAIL")
fi

gcloud run deploy "$SERVICE_NAME" "${DEPLOY_ARGS[@]}"

DISPATCHER_URL=$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')
echo "Dispatcher URL: $DISPATCHER_URL"

# Ensure Pub/Sub push subscription exists for dispatcher
if ! gcloud pubsub subscriptions describe $PUBSUB_SUBSCRIPTION --project $PROJECT_ID >/dev/null 2>&1; then
    gcloud pubsub subscriptions create $PUBSUB_SUBSCRIPTION \
        --topic $PUBSUB_TOPIC \
        --push-endpoint "${DISPATCHER_URL}/pubsub/push" \
        --project $PROJECT_ID
else
    gcloud pubsub subscriptions update $PUBSUB_SUBSCRIPTION \
        --push-endpoint "${DISPATCHER_URL}/pubsub/push" \
        --project $PROJECT_ID
fi