param([switch]$InstallDependencies)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ((hostname) -notmatch '^p\d{3}$') { throw 'Run this launcher inside the assigned pNNN hackathon VM.' }
sc.exe query 'Milestone XProtect Management Server' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'The XProtect Management Server service was not found.' }
if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
    $tools = Join-Path $env:LOCALAPPDATA 'RoboOpsTools'
    $npxFile = Get-ChildItem -LiteralPath $tools -Filter npx.cmd -Recurse -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.DirectoryName 'node.exe') } |
        Select-Object -First 1
    if (-not $npxFile) { throw 'Portable Node.js was not found under LOCALAPPDATA\RoboOpsTools. Restore the Node.js ZIP first.' }
    $env:PATH = $npxFile.DirectoryName + ';' + $env:PATH
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    $uvDirectory = Join-Path $env:USERPROFILE '.local\bin'
    if (Test-Path -LiteralPath (Join-Path $uvDirectory 'uv.exe')) { $env:PATH = $uvDirectory + ';' + $env:PATH }
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { throw 'uv is required. Install it using the official Windows uv installer.' }
$env:UV_PYTHON = '3.12'
$env:XPROTECT_BASE_URL = 'http://localhost'
$env:XPROTECT_TOKEN_URL = 'http://localhost/API/IDP/connect/token'
$env:XPROTECT_CLIENT_ID = 'GrantValidatorClient'
if (-not $env:XPROTECT_USERNAME -or -not $env:XPROTECT_PASSWORD) {
    $basic = Get-Credential -UserName 'Smart-City-RoboOps' -Message 'XProtect Basic user (not the Windows Administrator)'
    if (-not $basic) { throw 'Basic-user credentials are required.' }
    $env:XPROTECT_USERNAME = $basic.UserName
    $env:XPROTECT_PASSWORD = $basic.GetNetworkCredential().Password
    Remove-Variable basic
}
if (-not $env:HAFNIA_GW_PASSWORD) {
    $gateway = Get-Credential -UserName 'administrator' -Message 'Local Hafnia gateway credentials (Windows Administrator password)'
    if (-not $gateway) { throw 'Gateway credentials are required.' }
    $env:HAFNIA_GW_USER = $gateway.UserName
    $env:HAFNIA_GW_PASSWORD = $gateway.GetNetworkCredential().Password
    Remove-Variable gateway
}
# This exception applies ONLY to the fixed https://localhost:15443 client.
$env:HAFNIA_GW_ALLOW_SELF_SIGNED = 'true'
Push-Location -LiteralPath $projectRoot
try {
    if ($InstallDependencies) {
        & npx.cmd --yes pnpm@10 install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npx.cmd --yes pnpm@10 dev
}
finally { Pop-Location }
