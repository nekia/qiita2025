locals {
  env_suffix = var.environment == "production" ? "" : "-${var.environment}"

  firestore_database_id = var.firestore_database_id != "" ? var.firestore_database_id : "line-msg-store${local.env_suffix}"
  pubsub_topic_name     = var.pubsub_topic_name != "" ? var.pubsub_topic_name : "kiosk-events${local.env_suffix}"
  pubsub_sub_name       = var.pubsub_subscription_name != "" ? var.pubsub_subscription_name : "kiosk-events-dispatcher${local.env_suffix}"
  line_image_bucket     = var.line_image_bucket_name != "" ? var.line_image_bucket_name : "kiosk-line-image${local.env_suffix}"

  api_name     = var.api_gateway_api_name != "" ? var.api_gateway_api_name : "line-webhook-api${local.env_suffix}"
  config_name  = var.api_gateway_config_name != "" ? var.api_gateway_config_name : "line-webhook-config-${var.environment}-v1"
  gateway_name = var.api_gateway_name != "" ? var.api_gateway_name : "line-webhook-gateway${local.env_suffix}"

  line_webhook_service_name  = var.line_webhook_service_name != "" ? var.line_webhook_service_name : "line-webhook${local.env_suffix}"
  dispatcher_service_name    = var.dispatcher_service_name != "" ? var.dispatcher_service_name : "dispatcher${local.env_suffix}"
  kiosk_gateway_service_name = var.kiosk_gateway_service_name != "" ? var.kiosk_gateway_service_name : "kiosk-gateway${local.env_suffix}"

  line_webhook_sa_id  = "line-webhook${local.env_suffix}"
  dispatcher_sa_id    = "dispatcher${local.env_suffix}"
  kiosk_gateway_sa_id = "kiosk-gateway${local.env_suffix}"
  artifact_repo_id    = var.artifact_registry_repository_id != "" ? var.artifact_registry_repository_id : "kiosk"
  cloud_build_tag     = var.cloud_build_static_tag != "" ? var.cloud_build_static_tag : var.environment

  cloud_build_services = {
    line-webhook = {
      context = "line-webhook"
    }
    dispatcher = {
      context = "services/dispatcher"
    }
    kiosk-gateway = {
      context = "services/kiosk-gateway"
    }
  }

  dispatcher_push_endpoint_effective = var.dispatcher_push_endpoint != "" ? var.dispatcher_push_endpoint : (
    var.enable_cloud_run_services && var.dispatcher_image != "" ? "${google_cloud_run_v2_service.dispatcher[0].uri}/pubsub/push" : ""
  )

  line_webhook_backend_url_effective = var.line_webhook_backend_url != "" ? var.line_webhook_backend_url : (
    var.enable_cloud_run_services && var.line_webhook_image != "" ? google_cloud_run_v2_service.line_webhook[0].uri : ""
  )
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each           = toset(var.enabled_apis)
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_firestore_database" "main" {
  count       = var.create_firestore_database ? 1 : 0
  project     = var.project_id
  name        = local.firestore_database_id
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.required]
}

resource "google_pubsub_topic" "kiosk_events" {
  name    = local.pubsub_topic_name
  project = var.project_id

  depends_on = [google_project_service.required]
}

resource "google_storage_bucket" "line_images" {
  name                        = local.line_image_bucket
  project                     = var.project_id
  location                    = var.region
  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 30
    }
    action {
      type = "Delete"
    }
  }

  depends_on = [google_project_service.required]
}

resource "google_artifact_registry_repository" "kiosk" {
  count         = var.create_artifact_registry_repository ? 1 : 0
  project       = var.project_id
  location      = var.region
  repository_id = local.artifact_repo_id
  format        = "DOCKER"
  description   = "Container images for kiosk services (${var.environment})"

  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "app" {
  for_each  = var.create_secrets ? toset(var.secret_names) : toset([])
  project   = var.project_id
  secret_id = each.value

  replication {
    auto {}
  }

  depends_on = [google_project_service.required]
}

resource "google_service_account" "line_webhook" {
  account_id   = local.line_webhook_sa_id
  display_name = "line-webhook (${var.environment})"
  project      = var.project_id
}

resource "google_service_account" "dispatcher" {
  account_id   = local.dispatcher_sa_id
  display_name = "dispatcher (${var.environment})"
  project      = var.project_id
}

resource "google_service_account" "kiosk_gateway" {
  account_id   = local.kiosk_gateway_sa_id
  display_name = "kiosk-gateway (${var.environment})"
  project      = var.project_id
}

resource "google_cloud_run_v2_service" "line_webhook" {
  count    = var.enable_cloud_run_services && var.line_webhook_image != "" ? 1 : 0
  name     = local.line_webhook_service_name
  location = var.region
  project  = var.project_id

  template {
    timeout         = "${var.cloud_run_timeout_seconds}s"
    service_account = google_service_account.line_webhook.email

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.line_webhook_image

      resources {
        limits = {
          cpu    = var.cloud_run_cpu
          memory = var.cloud_run_memory
        }
      }

      env {
        name  = "PUBSUB_TOPIC"
        value = local.pubsub_topic_name
      }
      env {
        name  = "DEVICE_ID"
        value = var.device_id
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = local.firestore_database_id
      }
      env {
        name  = "LINE_IMAGE_BUCKET"
        value = google_storage_bucket.line_images.name
      }
      env {
        name  = "LINE_IMAGE_PREFIX"
        value = var.line_image_prefix
      }
      env {
        name  = "LINE_IMAGE_URL_TTL_HOURS"
        value = tostring(var.line_image_url_ttl_hours)
      }
      env {
        name = "LINE_CHANNEL_ACCESS_TOKEN"
        value_source {
          secret_key_ref {
            secret  = var.secret_name_line_channel_access_token
            version = "latest"
          }
        }
      }
      env {
        name = "LINE_CHANNEL_SECRET"
        value_source {
          secret_key_ref {
            secret  = var.secret_name_line_channel_secret
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret.app,
    google_secret_manager_secret_iam_member.line_webhook_secret_accessor,
  ]
}

resource "google_cloud_run_v2_service" "dispatcher" {
  count    = var.enable_cloud_run_services && var.dispatcher_image != "" ? 1 : 0
  name     = local.dispatcher_service_name
  location = var.region
  project  = var.project_id

  template {
    timeout         = "${var.cloud_run_timeout_seconds}s"
    service_account = google_service_account.dispatcher.email

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.dispatcher_image

      resources {
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
        value = local.firestore_database_id
      }
      env {
        name = "GEMINI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = var.secret_name_gemini_api_key
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret.app,
    google_secret_manager_secret_iam_member.dispatcher_secret_accessor,
  ]
}

resource "google_cloud_run_v2_service" "kiosk_gateway" {
  count    = var.enable_cloud_run_services && var.kiosk_gateway_image != "" ? 1 : 0
  name     = local.kiosk_gateway_service_name
  location = var.region
  project  = var.project_id

  template {
    timeout         = "${var.cloud_run_timeout_seconds}s"
    service_account = google_service_account.kiosk_gateway.email

    scaling {
      min_instance_count = var.cloud_run_min_instances
      max_instance_count = var.cloud_run_max_instances
    }

    containers {
      image = var.kiosk_gateway_image

      resources {
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
        value = local.firestore_database_id
      }
      env {
        name = "LINE_CHANNEL_ACCESS_TOKEN"
        value_source {
          secret_key_ref {
            secret  = var.secret_name_line_channel_access_token
            version = "latest"
          }
        }
      }
      env {
        name = "LINE_CHANNEL_SECRET"
        value_source {
          secret_key_ref {
            secret  = var.secret_name_line_channel_secret
            version = "latest"
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.required,
    google_secret_manager_secret.app,
    google_secret_manager_secret_iam_member.kiosk_gateway_secret_accessor,
  ]
}

resource "google_cloud_run_service_iam_member" "dispatcher_invoker_all_users" {
  count    = var.enable_cloud_run_services && var.dispatcher_image != "" && var.dispatcher_allow_unauthenticated ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = local.dispatcher_service_name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_project_iam_member" "line_webhook_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.line_webhook.email}"
}

resource "google_project_iam_member" "line_webhook_pubsub_publisher" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${google_service_account.line_webhook.email}"
}

resource "google_project_iam_member" "line_webhook_storage_admin" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.line_webhook.email}"
}

resource "google_service_account_iam_member" "line_webhook_token_creator" {
  service_account_id = google_service_account.line_webhook.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.line_webhook.email}"
}

resource "google_project_iam_member" "dispatcher_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_project_iam_member" "kiosk_gateway_firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.kiosk_gateway.email}"
}

resource "google_secret_manager_secret_iam_member" "dispatcher_secret_accessor" {
  for_each = var.create_secrets ? {
    for s in [var.secret_name_gemini_api_key] : s => google_secret_manager_secret.app[s].secret_id
    if contains(var.secret_names, s)
    } : {
    for s in [var.secret_name_gemini_api_key] : s => s
  }
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.dispatcher.email}"
}

resource "google_secret_manager_secret_iam_member" "line_webhook_secret_accessor" {
  for_each = var.create_secrets ? {
    for s in [var.secret_name_line_channel_access_token, var.secret_name_line_channel_secret] : s => google_secret_manager_secret.app[s].secret_id
    if contains(var.secret_names, s)
    } : {
    for s in [var.secret_name_line_channel_access_token, var.secret_name_line_channel_secret] : s => s
  }
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.line_webhook.email}"
}

resource "google_secret_manager_secret_iam_member" "kiosk_gateway_secret_accessor" {
  for_each = var.create_secrets ? {
    for s in [var.secret_name_line_channel_access_token, var.secret_name_line_channel_secret] : s => google_secret_manager_secret.app[s].secret_id
    if contains(var.secret_names, s)
    } : {
    for s in [var.secret_name_line_channel_access_token, var.secret_name_line_channel_secret] : s => s
  }
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.kiosk_gateway.email}"
}

resource "google_pubsub_subscription" "dispatcher_push" {
  count   = local.dispatcher_push_endpoint_effective != "" ? 1 : 0
  name    = local.pubsub_sub_name
  topic   = google_pubsub_topic.kiosk_events.name
  project = var.project_id

  push_config {
    push_endpoint = local.dispatcher_push_endpoint_effective

    dynamic "oidc_token" {
      for_each = var.pubsub_push_service_account_email != "" ? [1] : []
      content {
        service_account_email = var.pubsub_push_service_account_email
        audience              = local.dispatcher_push_endpoint_effective
      }
    }
  }
}

resource "google_cloud_run_service_iam_member" "dispatcher_invoker_pubsub_sa" {
  count    = (var.dispatcher_cloud_run_service_name != "" || (var.enable_cloud_run_services && var.dispatcher_image != "")) && var.pubsub_push_service_account_email != "" ? 1 : 0
  project  = var.project_id
  location = var.region
  service  = var.dispatcher_cloud_run_service_name != "" ? var.dispatcher_cloud_run_service_name : local.dispatcher_service_name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.pubsub_push_service_account_email}"
}

resource "google_api_gateway_api" "line_webhook" {
  provider     = google-beta
  count        = var.enable_api_gateway && local.line_webhook_backend_url_effective != "" ? 1 : 0
  project      = var.project_id
  api_id       = local.api_name
  display_name = "line-webhook (${var.environment})"
}

resource "google_api_gateway_api_config" "line_webhook" {
  provider      = google-beta
  count         = var.enable_api_gateway && local.line_webhook_backend_url_effective != "" ? 1 : 0
  project       = var.project_id
  api           = google_api_gateway_api.line_webhook[0].api_id
  api_config_id = local.config_name

  openapi_documents {
    document {
      path = "openapi.yaml"
      contents = base64encode(templatefile("${path.module}/templates/apigateway-openapi.yaml.tftpl", {
        backend_url = local.line_webhook_backend_url_effective
      }))
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "google_api_gateway_gateway" "line_webhook" {
  provider     = google-beta
  count        = var.enable_api_gateway && local.line_webhook_backend_url_effective != "" ? 1 : 0
  project      = var.project_id
  region       = var.region
  api_config   = google_api_gateway_api_config.line_webhook[0].id
  gateway_id   = local.gateway_name
  display_name = "line-webhook (${var.environment})"
}

resource "google_cloudbuild_trigger" "service_images" {
  for_each = var.enable_cloud_build_triggers && var.github_owner != "" && var.github_repo_name != "" ? local.cloud_build_services : {}

  project     = var.project_id
  name        = "${replace(each.key, "-", "_")}_build_${var.environment}"
  description = "Build ${each.key} image on push (${var.environment})"
  filename    = "cloudbuild/build-service-image.yaml"

  github {
    owner = var.github_owner
    name  = var.github_repo_name
    push {
      branch = var.github_branch_regex
    }
  }

  included_files = [
    "${each.value.context}/**",
  ]

  substitutions = {
    _REGION      = var.region
    _REPOSITORY  = local.artifact_repo_id
    _IMAGE_NAME  = each.key
    _CONTEXT_DIR = each.value.context
    _STATIC_TAG  = local.cloud_build_tag
  }
}
