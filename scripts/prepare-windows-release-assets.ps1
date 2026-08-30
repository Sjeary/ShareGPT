param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\build\bin")
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$checksums = Get-Content (Join-Path $projectRoot "build\bin\checksums.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sharegpt-assets-" + [guid]::NewGuid())

function Get-Sha256 {
  param([string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try { return (($sha256.ComputeHash($stream) | ForEach-Object { $_.ToString("x2") }) -join "") }
    finally { $sha256.Dispose() }
  } finally { $stream.Dispose() }
}

function Get-VerifiedAsset {
  param(
    [string]$Label,
    [string]$Url,
    [string]$ArchiveName,
    [string]$RelativeExecutable,
    [string]$ExpectedSha256,
    [string]$DestinationName
  )

  $archivePath = Join-Path $temporaryDirectory $ArchiveName
  $extractPath = Join-Path $temporaryDirectory ($Label + "-extract")
  $lastError = $null
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try { Invoke-WebRequest -Uri $Url -OutFile $archivePath; $lastError = $null; break }
    catch { $lastError = $_; if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) } }
  }
  if ($lastError) { throw $lastError }
  Expand-Archive -Path $archivePath -DestinationPath $extractPath
  $sourcePath = Join-Path $extractPath $RelativeExecutable
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "$Label archive is incomplete" }
  $actual = Get-Sha256 -Path $sourcePath
  if ($actual -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "$Label SHA-256 mismatch: expected $ExpectedSha256, got $actual"
  }
  Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $OutputDirectory $DestinationName) -Force
}

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
try {
  $singBoxVersion = [string]$checksums."sing-box".windows.version
  Get-VerifiedAsset `
    "sing-box" `
    "https://github.com/SagerNet/sing-box/releases/download/v$singBoxVersion/sing-box-$singBoxVersion-windows-amd64.zip" `
    "sing-box.zip" `
    "sing-box-$singBoxVersion-windows-amd64\sing-box.exe" `
    ([string]$checksums."sing-box".windows.sha256) `
    "sing-box.exe"
  $frpcVersion = [string]$checksums.frpc.windows.version
  Get-VerifiedAsset `
    "frpc" `
    "https://github.com/fatedier/frp/releases/download/v$frpcVersion/frp_${frpcVersion}_windows_amd64.zip" `
    "frpc.zip" `
    "frp_${frpcVersion}_windows_amd64\frpc.exe" `
    ([string]$checksums.frpc.windows.sha256) `
    "frpc.exe"
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
