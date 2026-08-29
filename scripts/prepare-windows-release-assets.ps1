param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\build\bin\windows")
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$checksums = Get-Content (Join-Path $projectRoot "build\bin\checksums.json") -Raw | ConvertFrom-Json
$temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("sharegpt-assets-" + [guid]::NewGuid())

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
    try {
      Invoke-WebRequest -Uri $Url -OutFile $archivePath
      $lastError = $null
      break
    } catch {
      $lastError = $_
      if ($attempt -lt 3) { Start-Sleep -Seconds (2 * $attempt) }
    }
  }
  if ($lastError) { throw $lastError }

  Expand-Archive -Path $archivePath -DestinationPath $extractPath
  $sourcePath = Join-Path $extractPath $RelativeExecutable
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "$Label archive does not contain $RelativeExecutable"
  }

  $actualSha256 = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $ExpectedSha256.ToLowerInvariant()) {
    throw "$Label SHA-256 mismatch: expected $ExpectedSha256, got $actualSha256"
  }

  $destinationPath = Join-Path $OutputDirectory $DestinationName
  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  Write-Host "Prepared $Label $destinationPath ($actualSha256)"
}

New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
try {
  $singBoxVersion = [string]$checksums."sing-box".windows.version
  Get-VerifiedAsset `
    -Label "sing-box" `
    -Url "https://github.com/SagerNet/sing-box/releases/download/v$singBoxVersion/sing-box-$singBoxVersion-windows-amd64.zip" `
    -ArchiveName "sing-box.zip" `
    -RelativeExecutable "sing-box-$singBoxVersion-windows-amd64\sing-box.exe" `
    -ExpectedSha256 ([string]$checksums."sing-box".windows.sha256) `
    -DestinationName "sing-box.exe"

  $frpcVersion = [string]$checksums.frpc.windows.version
  Get-VerifiedAsset `
    -Label "frpc" `
    -Url "https://github.com/fatedier/frp/releases/download/v$frpcVersion/frp_${frpcVersion}_windows_amd64.zip" `
    -ArchiveName "frpc.zip" `
    -RelativeExecutable "frp_${frpcVersion}_windows_amd64\frpc.exe" `
    -ExpectedSha256 ([string]$checksums.frpc.windows.sha256) `
    -DestinationName "frpc.exe"
} finally {
  if (Test-Path -LiteralPath $temporaryDirectory) {
    Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
  }
}
