locals {
  env_suffix            = var.environment == "production" ? "" : "-${var.environment}"
  monitoring_service    = var.service_name != "" ? var.service_name : "monitoring-mother${local.env_suffix}"
  runtime_sa_account_id = "monitoring-mother${local.env_suffix}"
  scheduler_sa_id       = "mm-sch${local.env_suffix}"
}

resource "google_service_account" "runtime" {
  project      = var.project_id
  account_id   = local.runtime_sa_account_id
  display_name = "monitoring-mother runtime (${var.environment})"
}

resource "google_service_account" "scheduler_invoker" {
  project      = var.project_id
  account_id   = local.scheduler_sa_id
  display_name = "monitoring-mother scheduler invoker (${var.environment})"
}

resource "google_cloud_run_v2_service" "monitoring_mother" {
  project             = var.project_id
  location            = var.region
  name                = local.monitoring_service
  deletion_protection = false

  template {
    timeout                          = "${var.cloud_run_timeout_seconds}s"
    max_instance_request_concurrency = 1
    service_account                  = google_service_account.runtime.email

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.container_image

      resources {
        cpu_idle = true
        limits = {
          cpu    = var.cloud_run_cpu
          memory = var.cloud_run_memory
        }
      }

      env {
        name  = "FIRESTORE_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = var.firestore_database_id
      }
      env {
        name  = "TIMEZONE"
        value = var.timezone
      }
      dynamic "env" {
        for_each = var.line_group_id_secret_name != "" ? [var.line_group_id_secret_name] : []
        content {
          name = "LINE_GROUP_ID"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.line_group_id_secret_name == "" ? [var.line_group_id] : []
        content {
          name  = "LINE_GROUP_ID"
          value = env.value
        }
      }
      dynamic "env" {
        for_each = var.line_group_id_map_secret_name != "" ? [var.line_group_id_map_secret_name] : []
        content {
          name = "LINE_GROUP_ID_MAP"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      dynamic "env" {
        for_each = var.line_group_id_map_secret_name == "" ? [var.line_group_id_map] : []
        content {
          name  = "LINE_GROUP_ID_MAP"
          value = env.value
        }
      }
      env {
        name  = "SWITCHBOT_SITE_MAP"
        value = var.switchbot_site_map
      }
      env {
        name  = "DAILY_SUMMARY_LOOKBACK_HOURS"
        value = tostring(var.daily_summary_lookback_hours)
      }
      env {
        name  = "LOG_WEBHOOK_PAYLOAD"
        value = tostring(var.log_webhook_payload)
      }
      env {
        name  = "ENABLE_TEST_ENDPOINTS"
        value = tostring(var.enable_test_endpoints)
      }
      dynamic "env" {
        for_each = var.switchbot_webhook_token_secret_name != "" ? [var.switchbot_webhook_token_secret_name] : []
        content {
          name = "SWITCHBOT_WEBHOOK_TOKEN"
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      env {
        name  = "SWITCHBOT_ALLOWED_DEVICE_MACS"
        value = var.switchbot_allowed_device_macs
      }
      env {
        name  = "SWITCHBOT_ALLOWED_DEVICE_TYPES"
        value = var.switchbot_allowed_device_types
      }
      env {
        name  = "LEARNING_LOOKBACK_DAYS"
        value = tostring(var.learning_lookback_days)
      }
      env {
        name  = "ANOMALY_EXPECTED_THRESHOLD"
        value = tostring(var.anomaly_expected_threshold)
      }
      env {
        name  = "ANOMALY_INACTIVE_HOURS"
        value = tostring(var.anomaly_inactive_hours)
      }
      env {
        name = "SWITCHBOT_WEBHOOK_SECRET"
        value_source {
          secret_key_ref {
            secret  = var.switchbot_secret_name
            version = "latest"
          }
        }
      }
      env {
        name = "LINE_CHANNEL_ACCESS_TOKEN"
        value_source {
          secret_key_ref {
            secret  = var.line_channel_access_token_secret_name
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_secret_manager_secret_iam_member.runtime_secret_accessor,
    google_project_iam_member.runtime_firestore_user,
  ]
}

resource "google_cloud_run_service_iam_member" "allow_public" {
  count    = var.allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = google_cloud_run_v2_service.monitoring_mother.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_service_iam_member" "allow_scheduler_invocation" {
  project  = var.project_id
  location = var.region
  service  = google_cloud_run_v2_service.monitoring_mother.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler_invoker.email}"
}

resource "google_project_iam_member" "runtime_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "runtime_secret_accessor" {
  for_each = toset(
    compact([
      var.switchbot_secret_name,
      var.line_channel_access_token_secret_name,
      var.switchbot_webhook_token_secret_name,
      var.line_group_id_secret_name,
      var.line_group_id_map_secret_name,
    ])
  )
  project   = var.project_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
  secret_id = each.value
}

resource "google_cloud_scheduler_job" "learning" {
  project     = var.project_id
  region      = var.region
  name        = "${local.monitoring_service}-learn"
  schedule    = var.learning_schedule
  time_zone   = var.timezone
  description = "Daily learning for monitoring-mother"

  http_target {
    uri         = "${google_cloud_run_v2_service.monitoring_mother.uri}/jobs/learn"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = google_cloud_run_v2_service.monitoring_mother.uri
    }
  }
}

resource "google_cloud_scheduler_job" "detection" {
  project     = var.project_id
  region      = var.region
  name        = "${local.monitoring_service}-detect"
  schedule    = var.detection_schedule
  time_zone   = var.timezone
  description = "Anomaly detection every 30 minutes"

  http_target {
    uri         = "${google_cloud_run_v2_service.monitoring_mother.uri}/jobs/detect"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = google_cloud_run_v2_service.monitoring_mother.uri
    }
  }
}

resource "google_cloud_scheduler_job" "daily_summary" {
  count       = var.enable_daily_summary ? 1 : 0
  project     = var.project_id
  region      = var.region
  name        = "${local.monitoring_service}-daily-summary"
  schedule    = var.daily_summary_schedule
  time_zone   = var.timezone
  description = "Daily activity summary report"

  http_target {
    uri         = "${google_cloud_run_v2_service.monitoring_mother.uri}/jobs/daily-summary"
    http_method = "POST"
    oidc_token {
      service_account_email = google_service_account.scheduler_invoker.email
      audience              = google_cloud_run_v2_service.monitoring_mother.uri
    }
  }
}

resource "google_firestore_index" "events_by_device_timestamp" {
  project    = var.project_id
  database   = var.firestore_database_id
  collection = "sb_events"

  fields {
    field_path = "device_id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "timestamp"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "events_by_type_timestamp" {
  project    = var.project_id
  database   = var.firestore_database_id
  collection = "sb_events"

  fields {
    field_path = "event_type"
    order      = "ASCENDING"
  }

  fields {
    field_path = "timestamp"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "DESCENDING"
  }
}
