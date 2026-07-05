# SwitchBot Webhook 確認・設定スクリプト
#
# SwitchBot API 呼び出しには SwitchBot アプリの「開発者向けオプション」で取得した
# API トークン / シークレットが必要です（Secret Manager の switchbot_webhook_token とは別物）。
#
# usage:
#   .\switchbot-webhook.ps1 query
#   .\switchbot-webhook.ps1 urls
#   .\switchbot-webhook.ps1 set -Environment production
#   .\switchbot-webhook.ps1 set -Environment development
#   .\switchbot-webhook.ps1 set -Url "https://example.run.app/webhook/switchbot?token=..."
#
# 認証情報の指定（いずれか）:
#   $env:SWITCHBOT_API_TOKEN / $env:SWITCHBOT_API_SECRET
#   -SwitchBotToken / -SwitchBotSecret

param(
    [Parameter(Position = 0)]
    [ValidateSet("query", "set", "urls")]
    [string]$Action = "query",

    [ValidateSet("production", "development")]
    [string]$Environment = "production",

    [string]$Url,
    [string]$SwitchBotToken = $env:SWITCHBOT_API_TOKEN,
    [string]$SwitchBotSecret = $env:SWITCHBOT_API_SECRET,
    [string]$Region = "asia-northeast1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$EnvConfig = @{
    production = @{
        ProjectId   = "line-msg-kiosk-board"
        ServiceName = "monitoring-mother"
        SecretName  = "switchbot_webhook_token"
    }
    development = @{
        ProjectId   = "line-msg-kiosk-board-dev"
        ServiceName = "monitoring-mother-dev"
        SecretName  = "switchbot_webhook_token"
    }
}

function Write-Info([string]$Message) {
    Write-Host $Message -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host $Message -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Err([string]$Message) {
    Write-Host $Message -ForegroundColor Red
}

function New-SwitchBotHeaders {
    param(
        [Parameter(Mandatory = $true)][string]$Token,
        [Parameter(Mandatory = $true)][string]$Secret
    )

    $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
    $nonce = [guid]::NewGuid().ToString()
    $data = [Text.Encoding]::UTF8.GetBytes("$Token$t$nonce")
    $key = [Text.Encoding]::UTF8.GetBytes($Secret)
    $hmac = [System.Security.Cryptography.HMACSHA256]::new()
    $hmac.Key = $key
    $sign = [Convert]::ToBase64String($hmac.ComputeHash($data))

    return @{
        Authorization = $Token
        sign          = $sign
        t             = $t
        nonce         = $nonce
        "Content-Type" = "application/json"
    }
}

function Invoke-SwitchBotApi {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Headers,
        [Parameter(Mandatory = $true)][object]$Body
    )

    $json = $Body | ConvertTo-Json -Depth 5 -Compress
    try {
        return Invoke-RestMethod -Uri "https://api.switch-bot.com/v1.1/webhook/$Path" -Method POST -Headers $Headers -Body $json
    } catch {
        $detail = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace($detail)) {
            throw $_
        }
        throw "SwitchBot API error ($Path): $detail"
    }
}

function Get-CloudRunServiceUrl {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$ServiceName,
        [Parameter(Mandatory = $true)][string]$Region
    )

    $url = gcloud run services describe $ServiceName `
        --project $ProjectId `
        --region $Region `
        --format "value(status.url)" 2>$null

    if ([string]::IsNullOrWhiteSpace($url)) {
        throw "Cloud Run service not found: $ServiceName ($ProjectId / $Region)"
    }
    return $url.Trim()
}

function Get-WebhookQueryToken {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectId,
        [Parameter(Mandatory = $true)][string]$SecretName
    )

    $token = gcloud secrets versions access latest `
        --secret $SecretName `
        --project $ProjectId 2>$null

    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "Secret not found or empty: $SecretName ($ProjectId)"
    }
    return $token.Trim()
}

function Build-MonitoringMotherWebhookUrl {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [Parameter(Mandatory = $true)][string]$QueryToken
    )

    $base = $BaseUrl.TrimEnd("/")
    return "$base/webhook/switchbot?token=$QueryToken"
}

function Get-ResolvedWebhookUrl {
    param(
        [Parameter(Mandatory = $true)][string]$EnvironmentName
    )

    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        return $Url.Trim()
    }

    $cfg = $EnvConfig[$EnvironmentName]
    if (-not $cfg) {
        throw "Unknown environment: $EnvironmentName"
    }

    $serviceUrl = Get-CloudRunServiceUrl -ProjectId $cfg.ProjectId -ServiceName $cfg.ServiceName -Region $Region
    $queryToken = Get-WebhookQueryToken -ProjectId $cfg.ProjectId -SecretName $cfg.SecretName
    return Build-MonitoringMotherWebhookUrl -BaseUrl $serviceUrl -QueryToken $queryToken
}

function Get-SwitchBotCredentials {
    if ([string]::IsNullOrWhiteSpace($SwitchBotToken)) {
        $SwitchBotToken = Read-Host "SwitchBot API Token (開発者向けオプション)"
    }
    if ([string]::IsNullOrWhiteSpace($SwitchBotSecret)) {
        $SwitchBotSecret = Read-Host "SwitchBot API Secret (開発者向けオプション)" -AsSecureString
        $SwitchBotSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SwitchBotSecret)
        )
    }

    if ([string]::IsNullOrWhiteSpace($SwitchBotToken) -or [string]::IsNullOrWhiteSpace($SwitchBotSecret)) {
        throw "SwitchBot API Token / Secret が未設定です。環境変数 SWITCHBOT_API_TOKEN / SWITCHBOT_API_SECRET か引数で指定してください。"
    }
}

function Show-WebhookResponse {
    param([object]$Response)

    $json = $Response | ConvertTo-Json -Depth 8
    Write-Host $json

    $url = $null
    if ($Response.body.url) { $url = $Response.body.url }
    elseif ($Response.url) { $url = $Response.url }
    elseif ($Response.data.url) { $url = $Response.data.url }

    if ($url) {
        Write-Host ""
        if ($url -match "monitoring-mother-dev") {
            Write-Warn "現在の Webhook: development ($url)"
        } elseif ($url -match "monitoring-mother") {
            Write-Ok "現在の Webhook: production ($url)"
        } else {
            Write-Info "現在の Webhook: $url"
        }
    }
}

function Invoke-QueryWebhook {
    Get-SwitchBotCredentials
    $headers = New-SwitchBotHeaders -Token $SwitchBotToken -Secret $SwitchBotSecret
    Write-Info "=== SwitchBot Webhook 設定確認 ==="
    $response = Invoke-SwitchBotApi -Path "queryWebhook" -Headers $headers -Body @{ action = "queryUrl" }
    Show-WebhookResponse -Response $response
}

function Invoke-SetWebhook {
    param([Parameter(Mandatory = $true)][string]$TargetUrl)

    Get-SwitchBotCredentials
    $headers = New-SwitchBotHeaders -Token $SwitchBotToken -Secret $SwitchBotSecret

    Write-Info "=== SwitchBot Webhook 更新 ==="
    Write-Host "Target URL: $TargetUrl"
    Write-Host ""

    if (-not $Force) {
        $answer = Read-Host "この URL に更新しますか? [y/N]"
        if ($answer -notin @("y", "Y", "yes", "YES")) {
            Write-Warn "キャンセルしました。"
            return
        }
    }

    $updateBody = @{
        action = "updateWebhook"
        config = @{
            url    = $TargetUrl
            enable = $true
        }
    }

    try {
        $response = Invoke-SwitchBotApi -Path "updateWebhook" -Headers $headers -Body $updateBody
        Write-Ok "updateWebhook 成功"
        Show-WebhookResponse -Response $response
    } catch {
        Write-Warn "updateWebhook 失敗。setupWebhook を試します..."
        Write-Host $_.Exception.Message
        $setupBody = @{
            action     = "setupWebhook"
            url        = $TargetUrl
            deviceList = "ALL"
        }
        $response = Invoke-SwitchBotApi -Path "setupWebhook" -Headers $headers -Body $setupBody
        Write-Ok "setupWebhook 成功"
        Show-WebhookResponse -Response $response
    }

    Write-Host ""
    Write-Info "=== 更新後の確認 ==="
    Invoke-QueryWebhook
}

function Show-EnvironmentUrls {
    Write-Info "=== monitoring-mother Webhook URL 一覧 ==="
    foreach ($name in @("production", "development")) {
        $cfg = $EnvConfig[$name]
        try {
            $serviceUrl = Get-CloudRunServiceUrl -ProjectId $cfg.ProjectId -ServiceName $cfg.ServiceName -Region $Region
            $queryToken = Get-WebhookQueryToken -ProjectId $cfg.ProjectId -SecretName $cfg.SecretName
            $webhookUrl = Build-MonitoringMotherWebhookUrl -BaseUrl $serviceUrl -QueryToken $queryToken
            Write-Host ""
            Write-Host "$name"
            Write-Host "  project : $($cfg.ProjectId)"
            Write-Host "  service : $($cfg.ServiceName)"
            Write-Host "  url     : $webhookUrl"
        } catch {
            Write-Warn "$name : $($_.Exception.Message)"
        }
    }
}

switch ($Action) {
    "query" { Invoke-QueryWebhook }
    "set" {
        $targetUrl = Get-ResolvedWebhookUrl -EnvironmentName $Environment
        Invoke-SetWebhook -TargetUrl $targetUrl
    }
    "urls" { Show-EnvironmentUrls }
}
