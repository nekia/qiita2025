variable "project_id" {
  type = string
}

variable "region" {
  type = string
}

variable "environment" {
  type = string
}

variable "service_name" {
  type    = string
  default = ""
}

variable "firestore_database_id" {
  type = string
}

variable "container_image" {
  type = string
}

variable "allow_unauthenticated" {
  type    = bool
  default = true
}

variable "cloud_run_min_instances" {
  type    = number
  default = 0
}

variable "cloud_run_max_instances" {
  type    = number
  default = 2
}

variable "cloud_run_cpu" {
  type    = string
  default = "0.08"
}

variable "cloud_run_memory" {
  type    = string
  default = "256Mi"
}

variable "cloud_run_timeout_seconds" {
  type    = number
  default = 300
}

variable "timezone" {
  type    = string
  default = "Asia/Tokyo"
}

variable "learning_schedule" {
  type    = string
  default = "0 2 * * *"
}

variable "detection_schedule" {
  type    = string
  default = "*/30 * * * *"
}

variable "enable_daily_summary" {
  description = "If true, schedule daily summary LINE report job."
  type        = bool
  default     = false
}

variable "daily_summary_schedule" {
  description = "Cloud Scheduler cron for daily summary job."
  type        = string
  default     = "0 23 * * *"
}

variable "daily_summary_lookback_hours" {
  description = "Hours to look back when building daily summary."
  type        = number
  default     = 48
}

variable "line_group_id" {
  type    = string
  default = ""
}

variable "line_group_id_secret_name" {
  description = "Optional Secret Manager secret name for LINE_GROUP_ID."
  type        = string
  default     = ""
}

variable "line_group_id_map" {
  description = "Comma-separated map for per-site or per-device LINE targets. Example: SITE_A:Uxxx,AA11BB22CC33:Uyyy"
  type        = string
  default     = ""
}

variable "line_group_id_map_secret_name" {
  description = "Optional Secret Manager secret name for LINE_GROUP_ID_MAP."
  type        = string
  default     = ""
}

variable "switchbot_site_map" {
  description = "Comma-separated map from device MAC to logical site key. Example: AA11BB22CC33:mother-home"
  type        = string
  default     = ""
}

variable "log_webhook_payload" {
  description = "If true, log full webhook payloads in monitoring-mother."
  type        = bool
  default     = false
}

variable "switchbot_webhook_token_secret_name" {
  description = "Optional Secret Manager secret name for webhook URL query token fallback when signature headers are absent."
  type        = string
  default     = ""
}

variable "switchbot_allowed_device_macs" {
  description = "Comma-separated allowlist of SwitchBot device MACs. Empty means allow all."
  type        = string
  default     = ""
}

variable "switchbot_allowed_device_types" {
  description = "Comma-separated allowlist of SwitchBot device types (example: WoPresence). Empty means allow all."
  type        = string
  default     = ""
}

variable "learning_lookback_days" {
  type    = number
  default = 30
}

variable "anomaly_expected_threshold" {
  type    = number
  default = 0.7
}

variable "anomaly_inactive_hours" {
  type    = number
  default = 2
}

variable "switchbot_secret_name" {
  type    = string
  default = "switchbot_webhook_secret"
}

variable "line_channel_access_token_secret_name" {
  type    = string
  default = "line_channel_access_token"
}
