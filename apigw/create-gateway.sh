#!/bin/bash
# API Gateway作成スクリプト
#
# usage:
#   ./create-gateway.sh [API_NAME] [CONFIG_NAME] [GATEWAY_NAME]
#
# 例:
#   ./create-gateway.sh line-webhook-api line-webhook-config-v1 line-webhook-gateway

set -e

API_NAME=${1:-line-webhook-api}
CONFIG_NAME=${2:-line-webhook-config-v1}
GATEWAY_NAME=${3:-line-webhook-gateway}
PROJECT_ID=${GOOGLE_CLOUD_PROJECT:-162530971346}
LOCATION=${GOOGLE_CLOUD_REGION:-asia-northeast1}

echo "=== API Gateway作成 ==="
echo "API Name: $API_NAME"
echo "Config Name: $CONFIG_NAME"
echo "Gateway Name: $GATEWAY_NAME"
echo "Project ID: $PROJECT_ID"
echo "Location: $LOCATION"
echo ""

# Gateway作成
echo "Gatewayを作成中..."
gcloud api-gateway gateways create $GATEWAY_NAME \
  --api=$API_NAME \
  --api-config=$CONFIG_NAME \
  --location=$LOCATION \
  --project=$PROJECT_ID

echo ""
echo "=== Gateway作成完了 ==="
echo ""
echo "Gatewayの状態を確認:"
gcloud api-gateway gateways describe $GATEWAY_NAME \
  --location=$LOCATION \
  --project=$PROJECT_ID \
  --format="value(defaultHostname)"

echo ""
echo "Gateway URL:"
gcloud api-gateway gateways describe $GATEWAY_NAME \
  --location=$LOCATION \
  --project=$PROJECT_ID \
  --format="value(defaultHostname)" | xargs -I {} echo "https://{}/callback"

