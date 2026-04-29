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

variable "line_group_id" {
  type    = string
  default = ""
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
