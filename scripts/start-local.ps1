$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$portableTools = Join-Path (Split-Path -Parent $projectRoot) '.application-build\roboops-tools'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $portableNode = Get-ChildItem -LiteralPath $portableTools -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $portableNode) { throw 'Install Node.js 24 and pnpm, or restore the portable tools used for this checkout.' }
    $env:PATH = $portableNode.DirectoryName + ';' + $env:PATH
}
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    $portablePnpm = Join-Path $portableTools 'node_modules\.bin'
    if (-not (Test-Path -LiteralPath (Join-Path $portablePnpm 'pnpm.cmd'))) { throw 'pnpm is required. Install pnpm 10.' }
    $env:PATH = $portablePnpm + ';' + $env:PATH
}
Push-Location -LiteralPath $projectRoot
try { & pnpm.cmd dev }
finally { Pop-Location }
