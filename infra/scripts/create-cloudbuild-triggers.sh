#!/bin/bash
# Create Cloud Build triggers using gcloud triggers import (compatible with 1st-gen GitHub App connection).
# Usage: PROJECT_ID=... ENVIRONMENT=... GITHUB_OWNER=... GITHUB_REPO=... ./create-cloudbuild-triggers.sh

set -euo pipefail

PROJECT_ID=${PROJECT_ID:-line-msg-kiosk-board-dev}
ENVIRONMENT=${ENVIRONMENT:-development}
GITHUB_OWNER=${GITHUB_OWNER:-nekia}
GITHUB_REPO=${GITHUB_REPO:-qiita2025}
BRANCH=${BRANCH:-main}
REGION=${REGION:-asia-northeast1}
REPOSITORY=${REPOSITORY:-kiosk}
STATIC_TAG=${STATIC_TAG:-dev}

declare -A SERVICES
SERVICES["line-webhook"]="line-webhook"
SERVICES["dispatcher"]="services/dispatcher"
SERVICES["kiosk-gateway"]="services/kiosk-gateway"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

for IMAGE_NAME in "${!SERVICES[@]}"; do
  CONTEXT_DIR="${SERVICES[$IMAGE_NAME]}"
  TRIGGER_NAME="${IMAGE_NAME}-build-${ENVIRONMENT}"
  YAML_FILE="${TMPDIR}/${TRIGGER_NAME}.yaml"

  cat > "$YAML_FILE" <<YAML
name: ${TRIGGER_NAME}
github:
  owner: ${GITHUB_OWNER}
  name: ${GITHUB_REPO}
  push:
    branch: ^${BRANCH}$
filename: cloudbuild/build-service-image.yaml
includedFiles:
- ${CONTEXT_DIR}/**
serviceAccount: projects/${PROJECT_ID}/serviceAccounts/cloud-build-${ENVIRONMENT}@${PROJECT_ID}.iam.gserviceaccount.com
substitutions:
  _REGION: ${REGION}
  _REPOSITORY: ${REPOSITORY}
  _IMAGE_NAME: ${IMAGE_NAME}
  _CONTEXT_DIR: ${CONTEXT_DIR}
  _STATIC_TAG: ${STATIC_TAG}
YAML

  echo "Creating trigger: ${TRIGGER_NAME}"
  gcloud builds triggers import \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --source="${YAML_FILE}"
  echo "  Done: ${TRIGGER_NAME}"
done

echo "All triggers created."
