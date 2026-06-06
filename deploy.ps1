#requires -Version 5.1
<#
.SYNOPSIS
    Manuell zip-deploy av CIBoost-API till Azure Function App (utan GitHub Actions).

.DESCRIPTION
    1) Kontrollerar att du är inloggad i az CLI.
    2) Installerar prod-beroenden (npm install --omit=dev).
    3) Bygger en korrekt deploy-zip med FORWARD SLASHES via .NET — undviker
       PowerShell 5.1:s Compress-Archive-bugg (backslash-separatorer) som gör att
       Windows-Kudu inte hittar funktionerna.
    4) Deployar via `az functionapp deployment source config-zip`.
    5) Verifierar att live-API:t svarar.

.EXAMPLE
    .\deploy.ps1
    # Om PowerShell blockerar scriptet:
    powershell -ExecutionPolicy Bypass -File .\deploy.ps1

.NOTES
    Kräver: az CLI (az login körd) och npm. Körs från repo-roten.
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'CIBoost-sales',
    [string]$AppName       = 'ciboost-api-v2',
    [switch]$KeepZip
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }

# 1. Azure-inloggning
Step '1/5  Kontrollerar Azure-inloggning'
$acctJson = az account show 2>$null
if (-not $acctJson) {
    Write-Host 'Inte inloggad i Azure. Kör först:  az login' -ForegroundColor Yellow
    exit 1
}
$acct = $acctJson | ConvertFrom-Json
Write-Host ("Inloggad som {0} (subscription: {1})" -f $acct.user.name, $acct.name)

# 2. Prod-beroenden
Step '2/5  npm install (prod)'
npm install --omit=dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install misslyckades' }

# 3. Bygg zip med forward slashes
Step '3/5  Bygger deploy-zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipPath = Join-Path $root 'deploy_manual.zip'
if ([System.IO.File]::Exists($zipPath)) { [System.IO.File]::Delete($zipPath) }

# Endast Function App-innehållet ska med (inte .git, .github, ciboost-app, index.html, *.zip ...)
$include = @('host.json', 'package.json', 'package-lock.json', 'HttpTrigger', 'node_modules')
$files = @()
foreach ($i in $include) {
    $p = Join-Path $root $i
    if (-not (Test-Path $p)) { continue }
    if (Test-Path $p -PathType Leaf) { $files += Get-Item $p }
    else { $files += Get-ChildItem $p -Recurse -File }
}
if (-not (Test-Path (Join-Path $root 'HttpTrigger/index.js'))) { throw 'HttpTrigger/index.js saknas – kör scriptet från repo-roten.' }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
$level = [System.IO.Compression.CompressionLevel]::Fastest
foreach ($f in $files) {
    $rel = $f.FullName.Substring($root.Length + 1).Replace('\', '/')   # tvinga forward slash
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $rel, $level)
}
$zip.Dispose()
$mb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ("{0} filer, {1} MB" -f $files.Count, $mb)

# 4. Deploy
Step '4/5  Zip-deploy till Azure'
az functionapp deployment source config-zip -g $ResourceGroup -n $AppName --src $zipPath
if ($LASTEXITCODE -ne 0) { throw 'Deploy misslyckades' }

# 5. Health-check
Step '5/5  Verifierar live-API'
$appHost = az functionapp show -g $ResourceGroup -n $AppName --query defaultHostName -o tsv
foreach ($p in 'customers', 'prospects') {
    try { $code = (Invoke-WebRequest -Uri "https://$appHost/$p" -Method Get -TimeoutSec 60 -UseBasicParsing).StatusCode }
    catch { $code = $_.Exception.Response.StatusCode.value__ }
    Write-Host ("GET /{0} -> {1}" -f $p, $code)
}

if (-not $KeepZip) { [System.IO.File]::Delete($zipPath) }
Write-Host "`nKlar. ✔" -ForegroundColor Green
