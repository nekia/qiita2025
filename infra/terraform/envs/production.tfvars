project_id  = "line-msg-kiosk-board"
region      = "asia-northeast1"
environment = "production"

# Existing production resources should be imported into Terraform state first.
create_firestore_database = false
firestore_database_id     = "line-msg-store"

pubsub_topic_name        = "kiosk-events"
pubsub_subscription_name = "kiosk-events-dispatcher"
line_image_bucket_name   = "kiosk-line-image"
device_id                = "home-parents-1"

# Keep false until you are ready to manage production Cloud Run with Terraform.
# enable_cloud_run_services = true
# line_webhook_image        = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/line-webhook:prod"
# dispatcher_image          = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/dispatcher:prod"
# kiosk_gateway_image       = "asia-northeast1-docker.pkg.dev/line-msg-kiosk-board/kiosk/kiosk-gateway:prod"

# Existing URLs can be set after import or when re-managing these resources:
# dispatcher_push_endpoint = "https://dispatcher-xxxxx.a.run.app/pubsub/push"
# pubsub_push_service_account_email = "pubsub-push@line-msg-kiosk-board.iam.gserviceaccount.com"
# dispatcher_cloud_run_service_name = "dispatcher"
# enable_api_gateway = true
# line_webhook_backend_url = "https://line-webhook-xxxxx.a.run.app"
