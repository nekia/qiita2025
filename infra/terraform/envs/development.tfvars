project_id  = "line-msg-kiosk-board-dev"
region      = "asia-northeast1"
environment = "development"

create_firestore_database = true
firestore_database_id     = "line-msg-store-dev"

pubsub_topic_name        = "kiosk-events-dev"
pubsub_subscription_name = "kiosk-events-dispatcher-dev"
line_image_bucket_name   = "kiosk-line-image-dev"
device_id                = "home-parents-dev-1"

# Enable this when container images are ready:
enable_cloud_run_services = true
line_webhook_image        = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/line-webhook:dev"
dispatcher_image          = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/dispatcher:dev"
kiosk_gateway_image       = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/kiosk-gateway:dev"

# Build pipeline (optional):
# enable_cloud_build_triggers = true
# github_owner                = "nekia"
# github_repo_name            = "qiita2025-2"
# github_branch_regex         = "^main$"
# cloud_build_static_tag      = "dev"

# If you use Pub/Sub OIDC push authentication:
# pubsub_push_service_account_email = "pubsub-push@line-msg-kiosk-board-dev.iam.gserviceaccount.com"
# dispatcher_cloud_run_service_name = "dispatcher-dev"

# API Gateway can use Terraform-managed line-webhook URL automatically.
# If Cloud Run is managed outside Terraform, set explicit backend URL:
# enable_api_gateway = true
# line_webhook_backend_url = "https://line-webhook-dev-xxxxx.a.run.app"
