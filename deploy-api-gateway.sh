#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
API_NAME=${API_NAME:-line-webhook-api}
CONFIG_NAME=${CONFIG_NAME:-line-webhook-config-v3}
GATEWAY_NAME=${GATEWAY_NAME:-line-webhook-gateway}

gcloud api-gateway api-configs create $CONFIG_NAME   --api=$API_NAME   --openapi-spec=../apigw/openapi.yaml   --project=$PROJECT_ID
gcloud api-gateway gateways create $GATEWAY_NAME --api=$API_NAME --api-config=$CONFIG_NAME --location=$REGION --project=$PROJECT_ID

# gcloud api-gateway gateways update $GATEWAY_NAME   --api=$API_NAME   --api-config=$CONFIG_NAME   --location=$REGION   --project=$PROJECT_ID

LINE_WEBHOOK_GATEWAY_URL=$(gcloud api-gateway gateways describe $GATEWAY_NAME --location=$REGION --project=$PROJECT_ID --format='value(defaultHostname)')
echo "Line Webhook Gateway URL: $LINE_WEBHOOK_GATEWAY_URL"