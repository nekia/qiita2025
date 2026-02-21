output "environment" {
  value = var.environment
}

output "region" {
  value = var.region
}

output "firestore_database_id" {
  value = local.firestore_database_id
}

output "pubsub_topic_name" {
  value = google_pubsub_topic.kiosk_events.name
}

output "line_image_bucket_name" {
  value = google_storage_bucket.line_images.name
}

output "artifact_registry_repository" {
  value = {
    id       = local.artifact_repo_id
    location = var.region
    path     = "${var.region}-docker.pkg.dev/${var.project_id}/${local.artifact_repo_id}"
  }
}

output "service_accounts" {
  value = {
    line_webhook  = google_service_account.line_webhook.email
    dispatcher    = google_service_account.dispatcher.email
    kiosk_gateway = google_service_account.kiosk_gateway.email
  }
}

output "cloud_run_services" {
  value = {
    line_webhook = var.enable_cloud_run_services && var.line_webhook_image != "" ? {
      name = google_cloud_run_v2_service.line_webhook[0].name
      uri  = google_cloud_run_v2_service.line_webhook[0].uri
    } : null
    dispatcher = var.enable_cloud_run_services && var.dispatcher_image != "" ? {
      name = google_cloud_run_v2_service.dispatcher[0].name
      uri  = google_cloud_run_v2_service.dispatcher[0].uri
    } : null
    kiosk_gateway = var.enable_cloud_run_services && var.kiosk_gateway_image != "" ? {
      name = google_cloud_run_v2_service.kiosk_gateway[0].name
      uri  = google_cloud_run_v2_service.kiosk_gateway[0].uri
    } : null
  }
}

output "pubsub_subscription_name" {
  value = local.dispatcher_push_endpoint_effective != "" ? google_pubsub_subscription.dispatcher_push[0].name : null
}

output "api_gateway_default_hostname" {
  value = var.enable_api_gateway && local.line_webhook_backend_url_effective != "" ? google_api_gateway_gateway.line_webhook[0].default_hostname : null
}

output "cloud_build_triggers" {
  value = {
    for name, trigger in google_cloudbuild_trigger.service_images :
    name => {
      id   = trigger.id
      name = trigger.name
    }
  }
}
