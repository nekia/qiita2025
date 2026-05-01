# Terraform: line-msg-kiosk-board environments

This directory manages Google Cloud infrastructure for:

- `production` project: `line-msg-kiosk-board`
- `development` project: `line-msg-kiosk-board-dev`

Using separate projects is strongly recommended to reduce risk of accidental production changes.

## What is managed

- Required Google APIs
- Firestore database (optional creation)
- Pub/Sub topic + optional push subscription
- Cloud Storage bucket for LINE images
- Secret Manager secret containers
- Service accounts + IAM roles
- Optional Cloud Run services (`line-webhook`, `dispatcher`, `kiosk-gateway`)
- Optional Cloud Run service (`monitoring-mother`) for SwitchBot anomaly detection
- Optional Artifact Registry + Cloud Build triggers
- Optional API Gateway resources

Cloud Run services are managed by Terraform when `enable_cloud_run_services = true`
and image URIs are provided.

## Prerequisites

- Terraform 1.6+
- `gcloud auth application-default login`
- IAM permissions to manage services, IAM, Firestore, Pub/Sub, Storage, Secret Manager, API Gateway

## Quick start: create development environment

```bash
cd infra/terraform
terraform init
terraform plan -var-file=envs/development.tfvars
terraform apply -var-file=envs/development.tfvars
```

If you want Cloud Run also managed by Terraform:

- set `enable_cloud_run_services = true`
- set image URIs:
  - `line_webhook_image`
  - `dispatcher_image`
  - `kiosk_gateway_image`
  - `monitoring_mother_image` (when `enable_monitoring_mother = true`)

Then run apply again. Pub/Sub push endpoint and API Gateway backend URL are auto-derived
from Terraform-managed Cloud Run URLs.

If you use Pub/Sub OIDC push auth, set:

- `pubsub_push_service_account_email` (usually `pubsub-push@line-msg-kiosk-board-dev.iam.gserviceaccount.com`)
- `dispatcher_cloud_run_service_name` (or let Terraform default naming handle it)

## Build and push images (example)

```bash
gcloud auth configure-docker asia-northeast1-docker.pkg.dev
gcloud artifacts repositories create kiosk --repository-format=docker --location=asia-northeast1 --project=line-msg-kiosk-board-dev || true

docker build -t asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/line-webhook:dev ./line-webhook
docker push asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/line-webhook:dev

docker build -t asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/dispatcher:dev ./services/dispatcher
docker push asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/dispatcher:dev

docker build -t asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/kiosk-gateway:dev ./services/kiosk-gateway
docker push asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/kiosk-gateway:dev

docker build -t asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/monitoring-mother:dev ./services/monitoring-mother
docker push asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/monitoring-mother:dev
```

## Build pipeline with Terraform (optional)

If you want image build itself as IaC, enable Cloud Build triggers in `envs/development.tfvars`:

- `enable_cloud_build_triggers = true`
- `github_owner`
- `github_repo_name`
- `github_branch_regex`
- `cloud_build_static_tag` (example: `dev`)

Then apply:

```bash
cd infra/terraform
terraform plan -var-file=envs/development.tfvars
terraform apply -var-file=envs/development.tfvars
```

Created triggers use `cloudbuild/build-service-image.yaml` and automatically build/push:

- `line-webhook`
- `dispatcher`
- `kiosk-gateway`
- `monitoring-mother`

## monitoring-mother: required settings

`monitoring-mother` is a Phase 2 service for statistical anomaly detection from
SwitchBot motion events.

Set these variables in `envs/*.tfvars`:

- `enable_monitoring_mother = true`
- `monitoring_mother_image`
- `monitoring_mother_line_group_id` (LINE group/room/user ID for alerts)
- `monitoring_mother_learning_schedule` (default daily)
- `monitoring_mother_detection_schedule` (default every 30 minutes)
- `monitoring_mother_enable_daily_summary` (default `false`)
- `monitoring_mother_daily_summary_schedule` (default `0 23 * * *`)
- `monitoring_mother_daily_summary_lookback_hours` (default `48`)
- `monitoring_mother_switchbot_site_map` (device MAC -> logical site key)
- `monitoring_mother_line_group_id_map` (site key or device MAC -> LINE target ID)
- `secret_name_monitoring_mother_line_group_id` (optional Secret Manager key for `LINE_GROUP_ID`)
- `secret_name_monitoring_mother_line_group_id_map` (optional Secret Manager key for `LINE_GROUP_ID_MAP`)
- `monitoring_mother_expected_threshold` (default `0.7`)
- `monitoring_mother_inactive_hours` (default `2`)
- `monitoring_mother_log_webhook_payload` (default `false`, enable only for short-term debugging)

Secrets (Secret Manager) used by this service:

- `switchbot_webhook_secret` (`secret_name_switchbot_webhook_secret`)
- `line_channel_access_token` (`secret_name_line_channel_access_token`)
- `switchbot_webhook_token` (`secret_name_switchbot_webhook_token`, optional fallback auth token)
- `monitoring_mother_line_group_id` (`secret_name_monitoring_mother_line_group_id`, optional)
- `monitoring_mother_line_group_id_map` (`secret_name_monitoring_mother_line_group_id_map`, optional)

Recommended logging posture:

- `development`: set `monitoring_mother_log_webhook_payload = true` only while investigating payloads
- `production`: keep `monitoring_mother_log_webhook_payload = false`

After apply, webhook URL is available from output:

```bash
terraform output monitoring_mother
```

Use `switchbot_webhook_endpoint` from that output as SwitchBot webhook destination.
If you use token fallback auth, append query token:
`https://<monitoring-mother-run-url>/webhook/switchbot?token=<your_webhook_token>`.

## SwitchBot Webhook setup notes

1. Set webhook URL to one of:
   - Signature-based: `https://<monitoring-mother-run-url>/webhook/switchbot`
   - Token fallback: `https://<monitoring-mother-run-url>/webhook/switchbot?token=<your_webhook_token>`
2. Set `switchbot_webhook_secret` in Secret Manager to the same secret used in SwitchBot console.
3. If using token fallback, store token value in Secret Manager secret specified by
   `secret_name_switchbot_webhook_token` (example: `switchbot_webhook_token`).
4. Service accepts either signature headers (`sign`/`X-Sign`) or query token auth,
   then stores events idempotently in Firestore `sb_events`.
5. `sb_state/global.last_detected_at` is updated on accepted motion webhook.

Quick sanity check:

```bash
gcloud run services describe monitoring-mother-dev \
  --region asia-northeast1 \
  --project line-msg-kiosk-board-dev \
  --format='value(status.url)'
```

Then confirm:

- Scheduler jobs exist (`*-learn`, `*-detect`)
- Firestore has collections: `sb_events`, `sb_stats`, `sb_state`
- LINE alert is sent only once while `current_mode = ALERT`

## Apply Terraform with Cloud Run

```bash
cd infra/terraform
terraform plan -var-file=envs/development.tfvars
terraform apply -var-file=envs/development.tfvars
```

## Production migration strategy (safe)

1. Do not destroy or rename existing production resources.
2. Use `envs/production.tfvars` and import existing resources into state.
3. Run plan and ensure `0 to destroy`.

Example imports (adjust names if different):

```bash
cd infra/terraform
terraform init

terraform import -var-file=envs/production.tfvars 'google_pubsub_topic.kiosk_events' 'projects/line-msg-kiosk-board/topics/kiosk-events'
terraform import -var-file=envs/production.tfvars 'google_storage_bucket.line_images' 'kiosk-line-image'
terraform import -var-file=envs/production.tfvars 'google_service_account.line_webhook' 'projects/line-msg-kiosk-board/serviceAccounts/line-webhook@line-msg-kiosk-board.iam.gserviceaccount.com'
terraform import -var-file=envs/production.tfvars 'google_service_account.dispatcher' 'projects/line-msg-kiosk-board/serviceAccounts/dispatcher@line-msg-kiosk-board.iam.gserviceaccount.com'
terraform import -var-file=envs/production.tfvars 'google_service_account.kiosk_gateway' 'projects/line-msg-kiosk-board/serviceAccounts/kiosk-gateway@line-msg-kiosk-board.iam.gserviceaccount.com'
```

For Firestore DB, enable creation only when you are sure state/import is aligned:

- `create_firestore_database = false` while importing existing production
- turn it `true` only if you manage a new DB from Terraform

## Recommended rollout

1. Apply `development`
2. Build and push dev container images
3. Apply `development` with `enable_cloud_run_services = true`
4. Connect Pub/Sub push and API Gateway (auto or explicit vars)
5. Validate end-to-end
6. Import `production` resources and switch to Terraform management safely
