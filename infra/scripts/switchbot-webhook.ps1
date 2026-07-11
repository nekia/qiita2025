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
#   .\switchbot-webhook.ps1 disable          # 現在の Webhook を無効化（イベント停止）
#   .\switchbot-webhook.ps1 enable           # 現在の Webhook を再有効化
#   .\switchbot-webhook.ps1 disable -Url "https://...."  # 特定 URL のみ無効化
#
# 認証情報の指定（いずれか）:
#   $env:SWITCHBOT_API_TOKEN / $env:SWITCHBOT_API_SECRET
#   -SwitchBotToken / -SwitchBotSecret

param(
    [Parameter(Position = 0)]
    [ValidateSet("query", "set", "urls", "disable", "enable")]
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
    if ([string]::IsNullOrWhiteSpace($script:SwitchBotToken)) {
        $script:SwitchBotToken = Read-Host "SwitchBot API Token (開発者向けオプション)"
    }
    if ([string]::IsNullOrWhiteSpace($script:SwitchBotSecret)) {
        $secure = Read-Host "SwitchBot API Secret (開発者向けオプション)" -AsSecureString
        $script:SwitchBotSecret = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        )
    }

    if ([string]::IsNullOrWhiteSpace($script:SwitchBotToken) -or [string]::IsNullOrWhiteSpace($script:SwitchBotSecret)) {
        throw "SwitchBot API Token / Secret が未設定です。環境変数 SWITCHBOT_API_TOKEN / SWITCHBOT_API_SECRET か引数で指定してください。"
    }
}

function Get-RegisteredWebhookUrls {
    param([Parameter(Mandatory = $true)][hashtable]$Headers)

    $response = Invoke-SwitchBotApi -Path "queryWebhook" -Headers $Headers -Body @{ action = "queryUrl" }
    $urls = @()

    if ($response.body.urls) {
        $urls = @($response.body.urls)
    } elseif ($response.body.url) {
        $urls = @($response.body.url)
    } elseif ($response.urls) {
        $urls = @($response.urls)
    } elseif ($response.url) {
        $urls = @($response.url)
    }

    return ,(@($urls | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }))
}

function Describe-WebhookUrl([string]$WebhookUrl) {
    if ($WebhookUrl -match "monitoring-mother-dev") {
        return "development"
    }
    if ($WebhookUrl -match "monitoring-mother") {
        return "production"
    }
    return "other"
}

function Show-WebhookResponse {
    param([object]$Response)

    $json = $Response | ConvertTo-Json -Depth 8
    Write-Host $json

    $urls = @()
    if ($Response.body.urls) { $urls = @($Response.body.urls) }
    elseif ($Response.body.url) { $urls = @($Response.body.url) }
    elseif ($Response.urls) { $urls = @($Response.urls) }
    elseif ($Response.url) { $urls = @($Response.url) }
    elseif ($Response.data.url) { $urls = @($Response.data.url) }

    foreach ($url in $urls) {
        if ([string]::IsNullOrWhiteSpace($url)) { continue }
        Write-Host ""
        $label = Describe-WebhookUrl $url
        switch ($label) {
            "development" { Write-Warn "現在の Webhook: development ($url)" }
            "production"  { Write-Ok "現在の Webhook: production ($url)" }
            default       { Write-Info "現在の Webhook: $url" }
        }
    }
}

function Invoke-QueryWebhook {
    Get-SwitchBotCredentials
    $headers = New-SwitchBotHeaders -Token $script:SwitchBotToken -Secret $script:SwitchBotSecret
    Write-Info "=== SwitchBot Webhook 設定確認 ==="
    $response = Invoke-SwitchBotApi -Path "queryWebhook" -Headers $headers -Body @{ action = "queryUrl" }
    Show-WebhookResponse -Response $response

    # enable 状態も取得できる場合は表示
    $urls = Get-RegisteredWebhookUrls -Headers $headers
    if ($urls.Count -gt 0) {
        try {
            $details = Invoke-SwitchBotApi -Path "queryWebhook" -Headers $headers -Body @{
                action = "queryDetails"
                urls   = @($urls)
            }
            Write-Host ""
            Write-Info "=== Webhook 詳細 (enable 状態) ==="
            Show-WebhookResponse -Response $details
        } catch {
            # queryDetails 非対応でも queryUrl 結果だけで十分
        }
    }
}

function Invoke-SetWebhookEnable {
    param(
        [Parameter(Mandatory = $true)][bool]$Enable
    )

    Get-SwitchBotCredentials
    $headers = New-SwitchBotHeaders -Token $script:SwitchBotToken -Secret $script:SwitchBotSecret

    $label = if ($Enable) { "有効化" } else { "無効化" }
    Write-Info "=== SwitchBot Webhook $label ==="

    $targetUrls = @()
    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        $targetUrls = @($Url.Trim())
    } else {
        $targetUrls = @(Get-RegisteredWebhookUrls -Headers $headers)
    }

    if ($targetUrls.Count -eq 0) {
        throw "対象の Webhook URL がありません。先に set で登録するか -Url を指定してください。"
    }

    Write-Host "対象 URL:"
    foreach ($u in $targetUrls) {
        Write-Host "  - $u  ($((Describe-WebhookUrl $u)))"
    }
    Write-Host "enable : $Enable"
    Write-Host ""

    if (-not $Force) {
        $answer = Read-Host "Webhook を${label}しますか? [y/N]"
        if ($answer -notin @("y", "Y", "yes", "YES")) {
            Write-Warn "キャンセルしました。"
            return
        }
    }

    foreach ($targetUrl in $targetUrls) {
        $updateBody = @{
            action = "updateWebhook"
            config = @{
                url    = $targetUrl
                enable = $Enable
            }
        }
        $response = Invoke-SwitchBotApi -Path "updateWebhook" -Headers $headers -Body $updateBody
        Write-Ok "updateWebhook 成功: $targetUrl (enable=$Enable)"
        Show-WebhookResponse -Response $response
    }

    Write-Host ""
    Write-Info "=== 更新後の確認 ==="
    Invoke-QueryWebhook
}

function Invoke-SetWebhook {
    param([Parameter(Mandatory = $true)][string]$TargetUrl)

    Get-SwitchBotCredentials
    $headers = New-SwitchBotHeaders -Token $script:SwitchBotToken -Secret $script:SwitchBotSecret

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
    "disable" { Invoke-SetWebhookEnable -Enable:$false }
    "enable"  { Invoke-SetWebhookEnable -Enable:$true }
    "urls" { Show-EnvironmentUrls }
}
