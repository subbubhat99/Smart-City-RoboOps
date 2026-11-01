param([Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
$targetRoot = (Resolve-Path -LiteralPath $TargetPath).Path.TrimEnd('\')
if (-not (Test-Path -LiteralPath (Join-Path $targetRoot 'backend\app\main.py'))) {
    throw 'TargetPath must be the existing Smart-City-RoboOps application root.'
}
$manifestPath = Join-Path $PSScriptRoot 'manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Run APPLY-UPDATE.ps1 from the extracted gateway update package.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$files = @()
foreach ($entry in $manifest.files) {
    $relative = [string]$entry.path
    if ([IO.Path]::IsPathRooted($relative) -or ($relative -split '[\\/]') -contains '..') { throw 'Unsafe package path.' }
    if ($relative -match '(?i)(^|/)(HackathonKit|node_modules|data|\.git)(/|$)' -or $relative -match '(^|/)\.env$' -or $relative -eq 'backend/camera-zones.json') { throw 'Excluded file in update.' }
    $source = [IO.Path]::GetFullPath((Join-Path (Join-Path $PSScriptRoot 'app') $relative))
    $destination = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
    $packageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'app'))
    if (-not $source.StartsWith($packageRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Source escaped the package.' }
    if (-not $destination.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination escaped the application.' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $entry.sha256) { throw "Checksum mismatch: $relative" }
    $files += @{ Relative=$relative; Source=$source; Destination=$destination }
}
$backupRoot = Join-Path $targetRoot ('.gateway-update-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
foreach ($file in $files) {
    if (Test-Path -LiteralPath $file.Destination) {
        $backup = Join-Path $backupRoot $file.Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $backup) -Force | Out-Null
        Copy-Item -LiteralPath $file.Destination -Destination $backup
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $file.Destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.Source -Destination $file.Destination -Force
}
Write-Output "Updated $($files.Count) source/documentation files. Backups: $backupRoot"
Write-Output 'Existing database, credentials, camera-zone configuration and node_modules were preserved.'
Write-Output 'From the application root, run: powershell -ExecutionPolicy Bypass -File .\scripts\start-vm.ps1'
