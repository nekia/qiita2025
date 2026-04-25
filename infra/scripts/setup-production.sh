#!/bin/bash
# Production 環境を Terraform 管理下に移行するセットアップスクリプト
#
# 前提条件:
#   - gcloud auth login 済み & 適切な権限がある
#   - terraform CLI がインストール済み
#   - プロジェクト line-msg-kiosk-board に既存リソースが存在する
#
# 使い方:
#   cd infra/terraform
#   bash ../scripts/setup-production.sh

set -euo pipefail

PROJECT_ID="line-msg-kiosk-board"
REGION="asia-northeast1"
TFVARS="envs/production.tfvars"
REPO="kiosk"
TAG="prod"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TF_DIR="$(cd "$SCRIPT_DIR/../terraform" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "============================================"
echo "  Production Environment Setup"
echo "============================================"
echo "  PROJECT_ID : $PROJECT_ID"
echo "  REGION     : $REGION"
echo "  TF_DIR     : $TF_DIR"
echo ""

cd "$TF_DIR"

# ─────────────────────────────────────────────
# Step 1: Terraform workspace
# ─────────────────────────────────────────────
echo "──── Step 1: Terraform workspace ────"
if terraform workspace list | grep -q 'production'; then
  echo "Workspace 'production' already exists. Selecting it."
  terraform workspace select production
else
  echo "Creating workspace 'production'..."
  terraform workspace new production
fi
echo ""

# ─────────────────────────────────────────────
# Step 2: Artifact Registry リポジトリ作成
# ─────────────────────────────────────────────
echo "──── Step 2: Ensure Artifact Registry repository exists ────"
if gcloud artifacts repositories describe "$REPO" \
     --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "  Repository '$REPO' already exists."
else
  echo "  Creating repository '$REPO' ..."
  gcloud artifacts repositories create "$REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --description="Container images for kiosk services (production)"
  echo "  ✓ Created."
fi
echo ""

# ─────────────────────────────────────────────
# Step 3: Docker イメージビルド & プッシュ
# ─────────────────────────────────────────────
echo "──── Step 3: Build & push Docker images ────"

declare -A SERVICES
SERVICES["line-webhook"]="line-webhook"
SERVICES["dispatcher"]="services/dispatcher"
SERVICES["kiosk-gateway"]="services/kiosk-gateway"

for IMAGE_NAME in "${!SERVICES[@]}"; do
  CONTEXT_DIR="${SERVICES[$IMAGE_NAME]}"
  IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:${TAG}"
  echo "Building $IMAGE_NAME from $CONTEXT_DIR ..."
  gcloud builds submit \
    --project="$PROJECT_ID" \
    --tag="$IMAGE_URI" \
    "$PROJECT_ROOT/$CONTEXT_DIR"
  echo "  ✓ $IMAGE_URI"
done
echo ""

# ─────────────────────────────────────────────
# Step 4: 既存リソースを Terraform state に import
# ─────────────────────────────────────────────
echo "──── Step 4: Import existing resources ────"

import_resource() {
  local ADDR="$1"
  local ID="$2"
  if terraform state show "$ADDR" >/dev/null 2>&1; then
    echo "  [skip] $ADDR (already in state)"
  else
    echo "  [import] $ADDR ← $ID"
    terraform import -var-file="$TFVARS" "$ADDR" "$ID" || echo "  [warn] import failed for $ADDR — will be created by apply"
  fi
}

# Firestore database
import_resource 'google_firestore_database.main[0]' \
  "projects/${PROJECT_ID}/databases/line-msg-store"

# Pub/Sub topic
import_resource 'google_pubsub_topic.kiosk_events' \
  "projects/${PROJECT_ID}/topics/kiosk-events"

# Pub/Sub subscription
import_resource 'google_pubsub_subscription.dispatcher_push[0]' \
  "projects/${PROJECT_ID}/subscriptions/kiosk-events-dispatcher"

# Cloud Storage bucket
import_resource 'google_storage_bucket.line_images' \
  "${PROJECT_ID}/kiosk-line-image"

# Artifact Registry
import_resource 'google_artifact_registry_repository.kiosk[0]' \
  "projects/${PROJECT_ID}/locations/${REGION}/repositories/kiosk"

# Secret Manager secrets — create_secrets=false なので import 不要（既存を参照のみ）

# Cloud Run services (既存の手動デプロイ分)
import_resource 'google_cloud_run_v2_service.line_webhook[0]' \
  "projects/${PROJECT_ID}/locations/${REGION}/services/line-webhook"

import_resource 'google_cloud_run_v2_service.dispatcher[0]' \
  "projects/${PROJECT_ID}/locations/${REGION}/services/dispatcher"

import_resource 'google_cloud_run_v2_service.kiosk_gateway[0]' \
  "projects/${PROJECT_ID}/locations/${REGION}/services/kiosk-gateway"

# API Gateway
import_resource 'google_api_gateway_api.line_webhook[0]' \
  "projects/${PROJECT_ID}/locations/global/apis/line-webhook-api"

import_resource 'google_api_gateway_gateway.line_webhook[0]' \
  "projects/${PROJECT_ID}/locations/${REGION}/gateways/line-webhook-gateway"

# Service accounts (Terraform creates: line-webhook, dispatcher, kiosk-gateway, cloud-build-production)
import_resource 'google_service_account.line_webhook' \
  "projects/${PROJECT_ID}/serviceAccounts/line-webhook@${PROJECT_ID}.iam.gserviceaccount.com"

import_resource 'google_service_account.dispatcher' \
  "projects/${PROJECT_ID}/serviceAccounts/dispatcher@${PROJECT_ID}.iam.gserviceaccount.com"

import_resource 'google_service_account.kiosk_gateway' \
  "projects/${PROJECT_ID}/serviceAccounts/kiosk-gateway@${PROJECT_ID}.iam.gserviceaccount.com"

import_resource 'google_service_account.cloud_build' \
  "projects/${PROJECT_ID}/serviceAccounts/cloud-build-production@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""

# ─────────────────────────────────────────────
# Step 5: Terraform plan & apply
# ─────────────────────────────────────────────
echo "──── Step 5: Terraform plan ────"
terraform plan -var-file="$TFVARS" -out=tfplan.production

echo ""
echo "Plan が問題なければ apply を実行します。"
read -rp "Apply しますか？ (yes/no): " REPLY
if [[ "$REPLY" == "yes" ]]; then
  terraform apply tfplan.production
else
  echo "Apply をスキップしました。手動で実行する場合:"
  echo "  terraform apply tfplan.production"
  echo ""
fi

# ─────────────────────────────────────────────
# Step 6: kiosk-tester SA に kiosk-gateway の invoker 権限を付与
# ─────────────────────────────────────────────
echo "──── Step 6: Grant kiosk-tester SA invoker role ────"
KIOSK_TESTER_SA="kiosk-tester@${PROJECT_ID}.iam.gserviceaccount.com"
echo "Granting roles/run.invoker on kiosk-gateway to ${KIOSK_TESTER_SA} ..."
gcloud run services add-iam-policy-binding kiosk-gateway \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${KIOSK_TESTER_SA}" \
  --role="roles/run.invoker" \
  || echo "[warn] Could not grant invoker role. Check manually."

echo ""

# ─────────────────────────────────────────────
# Step 7: 出力
# ─────────────────────────────────────────────
echo "──── Step 7: Production URLs ────"
KIOSK_GW_URL=$(gcloud run services describe kiosk-gateway \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)' 2>/dev/null || echo "(unknown)")

LINE_WEBHOOK_URL=$(gcloud run services describe line-webhook \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)' 2>/dev/null || echo "(unknown)")

GATEWAY_HOSTNAME=$(gcloud api-gateway gateways describe line-webhook-gateway \
  --location="$REGION" --project="$PROJECT_ID" \
  --format='value(defaultHostname)' 2>/dev/null || echo "(unknown)")

echo ""
echo "============================================"
echo "  Production Setup Complete!"
echo "============================================"
echo ""
echo "  Kiosk Gateway URL  : $KIOSK_GW_URL"
echo "  Line Webhook URL   : $LINE_WEBHOOK_URL"
echo "  API Gateway Host   : $GATEWAY_HOSTNAME"
echo ""
echo "── 次のステップ ──"
echo ""
echo "1. raspi/local-proxy/start-proxy.sh の TARGET_BASE を更新:"
echo "   export TARGET_BASE=\"$KIOSK_GW_URL\""
echo ""
echo "2. LINE Developer Console で Webhook URL を更新:"
echo "   https://${GATEWAY_HOSTNAME}/webhook"
echo ""
echo "3. Raspberry Pi にデプロイ:"
echo "   cd $PROJECT_ROOT/raspi"
echo "   source .env"
echo "   ./deploy-to-pi.sh"
echo ""
echo "4. Raspberry Pi 上でプロキシ再起動:"
echo "   ssh \$RASPI_HOST"
echo "   cd /home/atsushi/kiosk/raspi/local-proxy"
echo "   ./start-proxy.sh"
echo ""
