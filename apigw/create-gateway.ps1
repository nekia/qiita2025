# API Gateway作成スクリプト (PowerShell)
#
# usage:
#   .\create-gateway.ps1 [API_NAME] [CONFIG_NAME] [GATEWAY_NAME]
#
# 例:
#   .\create-gateway.ps1 line-webhook-api line-webhook-config-v1 line-webhook-gateway

param(
    [string]$ApiName = "line-webhook-api",
    [string]$ConfigName = "line-webhook-config-v1",
    [string]$GatewayName = "line-webhook-gateway",
    [string]$ProjectId = $env:GOOGLE_CLOUD_PROJECT,
    [string]$Location = $env:GOOGLE_CLOUD_REGION
)

if ([string]::IsNullOrEmpty($ProjectId)) {
    $ProjectId = "162530971346"
}
if ([string]::IsNullOrEmpty($Location)) {
    $Location = "asia-northeast1"
}

Write-Host "=== API Gateway作成 ===" -ForegroundColor Cyan
Write-Host "API Name: $ApiName"
Write-Host "Config Name: $ConfigName"
Write-Host "Gateway Name: $GatewayName"
Write-Host "Project ID: $ProjectId"
Write-Host "Location: $Location"
Write-Host ""

# Gateway作成
Write-Host "Gatewayを作成中..." -ForegroundColor Yellow
gcloud api-gateway gateways create $GatewayName `
  --api=$ApiName `
  --api-config=$ConfigName `
  --location=$Location `
  --project=$ProjectId

Write-Host ""
Write-Host "=== Gateway作成完了 ===" -ForegroundColor Green
Write-Host ""

# Gateway URL取得
Write-Host "Gateway URL:" -ForegroundColor Cyan
$hostname = gcloud api-gateway gateways describe $GatewayName `
  --location=$Location `
  --project=$ProjectId `
  --format="value(defaultHostname)"

Write-Host "https://$hostname/callback" -ForegroundColor Green

