project_id  = "line-msg-kiosk-board-dev"
region      = "asia-northeast1"
environment = "development"

create_firestore_database = true
firestore_database_id     = "line-msg-store-dev"

pubsub_topic_name        = "kiosk-events-dev"
pubsub_subscription_name = "kiosk-events-dispatcher-dev"
line_image_bucket_name   = "kiosk-line-image-dev"
device_id                = "home-parents-dev-1"

# Secrets are already created in the project; manage IAM bindings only.
create_secrets = false

# Enable this after image tags exist in Artifact Registry:
enable_cloud_run_services                      = true
line_webhook_image                             = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/line-webhook:dev"
dispatcher_image                               = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/dispatcher:dev"
dispatcher_gemini_model                        = "gemini-2.5-flash-lite"
kiosk_gateway_image                            = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/kiosk-gateway:dev"
line_webhook_service_name                      = "line-webhook-dev"
dispatcher_service_name                        = "dispatcher-dev"
kiosk_gateway_service_name                     = "kiosk-gateway-dev"
cloud_run_deletion_protection                  = false
kiosk_gateway_allow_unauthenticated            = true # dev キオスク／ノートPC からトークンなしでテスト可能にする
kiosk_gateway_min_instances                    = 1
kiosk_gateway_max_instances                    = 3
kiosk_gateway_max_instance_request_concurrency = 1
kiosk_gateway_poll_interval_ms                 = 10000

# Build pipeline:
# Triggers are created via gcloud (see infra/terraform/README.md).
enable_cloud_build_triggers = false
github_owner                = "nekia"
github_repo_name            = "qiita2025"
github_branch_regex         = "^main$"
github_branch_name          = "main"
cloud_build_static_tag      = "dev"

# If you use Pub/Sub OIDC push authentication:
# pubsub_push_service_account_email = "pubsub-push@line-msg-kiosk-board-dev.iam.gserviceaccount.com"
# dispatcher_cloud_run_service_name = "dispatcher-dev"

# API Gateway: LINE は Gateway URL に送信し、Gateway が認証付きで line-webhook を呼ぶ。
enable_api_gateway = true
# line_webhook_backend_url は未設定でよい（Terraform 管理の Cloud Run URL を自動利用）。

# monitoring-mother (SwitchBot Motion anomaly detection)
enable_monitoring_mother                         = true
monitoring_mother_service_name                   = "monitoring-mother-dev"
monitoring_mother_image                          = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board-dev/kiosk/monitoring-mother:dev"
monitoring_mother_allow_unauthenticated          = true
monitoring_mother_line_group_id                  = ""
secret_name_monitoring_mother_line_group_id      = "monitoring_mother_line_group_id"
monitoring_mother_line_group_id_map              = ""
secret_name_monitoring_mother_line_group_id_map  = "monitoring_mother_line_group_id_map"
monitoring_mother_switchbot_site_map             = "B0E9FECE1D92:MOTHER_HOME,FCF88D0D39C6:WIFE_MOTHER_HOME"
monitoring_mother_log_webhook_payload            = true
secret_name_switchbot_webhook_token              = "switchbot_webhook_token"
monitoring_mother_switchbot_allowed_device_macs  = "B0E9FECE1D92,FCF88D0D39C6"
monitoring_mother_switchbot_allowed_device_types = "WoPresence,Motion Sensor"
monitoring_mother_timezone                       = "Asia/Tokyo"
monitoring_mother_learning_schedule              = "0 2 * * *"
monitoring_mother_detection_schedule             = "*/30 * * * *"
monitoring_mother_enable_daily_summary           = true
monitoring_mother_daily_summary_schedule         = "0 23 * * *"
monitoring_mother_daily_summary_lookback_hours   = 48
monitoring_mother_learning_lookback_days         = 30
monitoring_mother_expected_threshold             = 0.7
monitoring_mother_inactive_hours                 = 2
secret_name_switchbot_webhook_secret             = "switchbot_webhook_secret"
