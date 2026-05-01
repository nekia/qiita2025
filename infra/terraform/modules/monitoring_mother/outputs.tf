output "service_name" {
  value = google_cloud_run_v2_service.monitoring_mother.name
}

output "service_url" {
  value = google_cloud_run_v2_service.monitoring_mother.uri
}

output "webhook_url" {
  value = "${google_cloud_run_v2_service.monitoring_mother.uri}/webhook/switchbot"
}

output "learning_job_name" {
  value = google_cloud_scheduler_job.learning.name
}

output "detection_job_name" {
  value = google_cloud_scheduler_job.detection.name
}

output "daily_summary_job_name" {
  value = var.enable_daily_summary ? google_cloud_scheduler_job.daily_summary[0].name : null
}

output "runtime_service_account_email" {
  value = google_service_account.runtime.email
}
