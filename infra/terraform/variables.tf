variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "Default region for regional resources."
  type        = string
  default     = "asia-northeast1"
}

variable "environment" {
  description = "Environment name. Example: production, development."
  type        = string
}

variable "create_firestore_database" {
  description = "If true, create Firestore database. Keep false for existing prod until import is done."
  type        = bool
  default     = false
}

variable "firestore_database_id" {
  description = "Firestore database ID. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "pubsub_topic_name" {
  description = "Pub/Sub topic name. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "pubsub_subscription_name" {
  description = "Pub/Sub push subscription name. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "line_image_bucket_name" {
  description = "Cloud Storage bucket for LINE image uploads. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "device_id" {
  description = "Default kiosk device ID used by line-webhook."
  type        = string
  default     = "home-parents-1"
}

variable "secret_names" {
  description = "Secret names to ensure exist in Secret Manager."
  type        = list(string)
  default = [
    "gemini-api-key",
    "line_channel_access_token",
    "line_channel_secret",
  ]
}

variable "create_secrets" {
  description = "If true, create Secret Manager secret containers."
  type        = bool
  default     = true
}

variable "enable_cloud_run_services" {
  description = "If true, manage Cloud Run services with Terraform."
  type        = bool
  default     = false
}

variable "line_webhook_service_name" {
  description = "Cloud Run service name for line-webhook. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "dispatcher_service_name" {
  description = "Cloud Run service name for dispatcher. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "kiosk_gateway_service_name" {
  description = "Cloud Run service name for kiosk-gateway. Empty means auto-generated from environment."
  type        = string
  default     = ""
}

variable "line_webhook_image" {
  description = "Container image URI for line-webhook."
  type        = string
  default     = ""
}

variable "dispatcher_image" {
  description = "Container image URI for dispatcher."
  type        = string
  default     = ""
}

variable "kiosk_gateway_image" {
  description = "Container image URI for kiosk-gateway."
  type        = string
  default     = ""
}

variable "line_image_prefix" {
  description = "Prefix path for uploaded LINE images."
  type        = string
  default     = "line-images"
}

variable "line_image_url_ttl_hours" {
  description = "Signed URL TTL hours for uploaded LINE images."
  type        = number
  default     = 168
}

variable "secret_name_gemini_api_key" {
  description = "Secret Manager secret name for Gemini API key."
  type        = string
  default     = "gemini-api-key"
}

variable "secret_name_line_channel_access_token" {
  description = "Secret Manager secret name for LINE channel access token."
  type        = string
  default     = "line_channel_access_token"
}

variable "secret_name_line_channel_secret" {
  description = "Secret Manager secret name for LINE channel secret."
  type        = string
  default     = "line_channel_secret"
}

variable "dispatcher_allow_unauthenticated" {
  description = "Allow unauthenticated invocation for dispatcher service."
  type        = bool
  default     = true
}

variable "cloud_run_cpu" {
  description = "CPU limit for Cloud Run services."
  type        = string
  default     = "1"
}

variable "cloud_run_memory" {
  description = "Memory limit for Cloud Run services."
  type        = string
  default     = "512Mi"
}

variable "cloud_run_min_instances" {
  description = "Minimum instance count for Cloud Run services."
  type        = number
  default     = 0
}

variable "cloud_run_max_instances" {
  description = "Maximum instance count for Cloud Run services."
  type        = number
  default     = 3
}

variable "cloud_run_timeout_seconds" {
  description = "Request timeout in seconds for Cloud Run services."
  type        = number
  default     = 300
}

variable "create_artifact_registry_repository" {
  description = "If true, create Artifact Registry repository for service images."
  type        = bool
  default     = true
}

variable "artifact_registry_repository_id" {
  description = "Artifact Registry repository ID used for Cloud Run images."
  type        = string
  default     = "kiosk"
}

variable "enable_cloud_build_triggers" {
  description = "If true, create Cloud Build triggers for service image builds."
  type        = bool
  default     = false
}

variable "github_owner" {
  description = "GitHub owner/org for Cloud Build trigger source."
  type        = string
  default     = ""
}

variable "github_repo_name" {
  description = "GitHub repository name for Cloud Build trigger source."
  type        = string
  default     = ""
}

variable "github_branch_regex" {
  description = "Regex for GitHub branch push trigger."
  type        = string
  default     = "^main$"
}

variable "cloud_build_static_tag" {
  description = "Static image tag pushed by Cloud Build in addition to COMMIT_SHA."
  type        = string
  default     = ""
}

variable "dispatcher_push_endpoint" {
  description = "Push endpoint URL for Pub/Sub subscription. If empty, subscription is not created."
  type        = string
  default     = ""
}

variable "pubsub_push_service_account_email" {
  description = "Service account email used in Pub/Sub push OIDC token. Empty means no OIDC token block."
  type        = string
  default     = ""
}

variable "dispatcher_cloud_run_service_name" {
  description = "Dispatcher Cloud Run service name for run.invoker IAM binding. If empty, binding is skipped."
  type        = string
  default     = ""
}

variable "enable_api_gateway" {
  description = "If true, create API Gateway resources."
  type        = bool
  default     = false
}

variable "line_webhook_backend_url" {
  description = "Backend URL used by API Gateway (Cloud Run line-webhook URL). Required when enable_api_gateway=true."
  type        = string
  default     = ""
}

variable "api_gateway_api_name" {
  description = "API Gateway API name."
  type        = string
  default     = ""
}

variable "api_gateway_config_name" {
  description = "API Gateway config name."
  type        = string
  default     = ""
}

variable "api_gateway_name" {
  description = "API Gateway gateway name."
  type        = string
  default     = ""
}

variable "enabled_apis" {
  description = "Google APIs to enable for this project."
  type        = list(string)
  default = [
    "run.googleapis.com",
    "pubsub.googleapis.com",
    "firestore.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "apigateway.googleapis.com",
    "servicemanagement.googleapis.com",
    "servicecontrol.googleapis.com",
  ]
}
