#!/bin/bash

REGION=${REGION:-asia-northeast1}
PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board}
API_NAME=${API_NAME:-line-webhook-api}
CONFIG_NAME=${CONFIG_NAME:-line-webhook-config-v3}
GATEWAY_NAME=${GATEWAY_NAME:-line-webhook-gateway}
OPENAPI_SPEC_PATH=${OPENAPI_SPEC_PATH:-../apigw/openapi.yaml}

gcloud api-gateway api-configs create $CONFIG_NAME   --api=$API_NAME   --openapi-spec="$OPENAPI_SPEC_PATH"   --project=$PROJECT_ID
gcloud api-gateway gateways create $GATEWAY_NAME --api=$API_NAME --api-config=$CONFIG_NAME --location=$REGION --project=$PROJECT_ID

# gcloud api-gateway gateways update $GATEWAY_NAME   --api=$API_NAME   --api-config=$CONFIG_NAME   --location=$REGION   --project=$PROJECT_ID

LINE_WEBHOOK_GATEWAY_URL=$(gcloud api-gateway gateways describe $GATEWAY_NAME --location=$REGION --project=$PROJECT_ID --format='value(defaultHostname)')
echo "Line Webhook Gateway URL: $LINE_WEBHOOK_GATEWAY_URL"