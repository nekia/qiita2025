project_id  = "line-msg-kiosk-board"
region      = "asia-northeast1"
environment = "production"

# 既存の Firestore を Terraform 管理下に置く（初回は terraform import が必要）
create_firestore_database = true
firestore_database_id     = "line-msg-store"

pubsub_topic_name        = "kiosk-events"
pubsub_subscription_name = "kiosk-events-dispatcher"
line_image_bucket_name   = "kiosk-line-image"
device_id                = "home-parents-1"

# 既存の Secret Manager シークレットを利用（Terraform で再作成しない）
create_secrets = false

# Cloud Run services
enable_cloud_run_services                      = true
line_webhook_image                             = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/line-webhook:prod"
dispatcher_image                               = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/dispatcher:prod"
dispatcher_gemini_model                        = "gemini-2.5-flash-lite"
kiosk_gateway_image                            = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/kiosk-gateway:prod"
cloud_run_deletion_protection                  = false
cloud_run_cpu                                  = "0.5"
cloud_run_memory                               = "256Mi"
kiosk_gateway_cpu                              = "0.08"
kiosk_gateway_memory                           = "256Mi"
kiosk_gateway_timeout_seconds                  = 3600
kiosk_gateway_allow_unauthenticated            = false
kiosk_gateway_min_instances                    = 1
kiosk_gateway_max_instances                    = 20
kiosk_gateway_max_instance_request_concurrency = 1

# Cloud Build triggers は 1st-gen GitHub App 経由で gcloud スクリプトで管理
# （Terraform の source_to_build は 2nd-gen 接続が必要なため使わない）
# 作成/更新: infra/scripts/create-cloudbuild-triggers.sh
enable_cloud_build_triggers = false
cloud_build_static_tag      = "prod"

# API Gateway: 既存リソース名に合わせる（初回は terraform import が必要）
# デフォルトの gateway 名は "line-webhook-gateway" (production suffix なし)
enable_api_gateway   = true
api_gateway_api_name = "line-webhook-api"

# monitoring-mother (SwitchBot Motion anomaly detection)
enable_monitoring_mother                         = true
monitoring_mother_service_name                   = "monitoring-mother"
monitoring_mother_image                          = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/monitoring-mother:prod"
monitoring_mother_allow_unauthenticated          = true
monitoring_mother_line_group_id                  = ""
secret_name_monitoring_mother_line_group_id      = "monitoring_mother_line_group_id"
monitoring_mother_line_group_id_map              = ""
secret_name_monitoring_mother_line_group_id_map  = "monitoring_mother_line_group_id_map"
monitoring_mother_switchbot_site_map             = "B0E9FECE1D92:MOTHER_HOME,FCF88D0D39C6:WIFE_MOTHER_HOME"
monitoring_mother_log_webhook_payload            = false
monitoring_mother_enable_test_endpoints          = false
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
