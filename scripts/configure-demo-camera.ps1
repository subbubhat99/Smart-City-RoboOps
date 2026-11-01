param(
    [Parameter(Mandatory=$true)][Guid]$CameraId,
    [Parameter(Mandatory=$true)][switch]$Illustrative
)
$ErrorActionPreference = 'Stop'
if (-not $Illustrative) { throw 'This helper creates an illustrative demo mapping only.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$path = Join-Path $projectRoot 'backend\camera-zones.json'
$zones = @{}
if (Test-Path -LiteralPath $path) {
    $existing = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    foreach ($property in $existing.PSObject.Properties) { $zones[$property.Name] = $property.Value }
}
$id = $CameraId.ToString()
if ($zones.ContainsKey($id)) { throw 'This camera already has a zone. Review camera-zones.json instead of replacing it.' }
$zones[$id] = @{
    label = 'Illustrative scooter-camera zone - NOT surveyed camera geography'
    mappingType = 'illustrative'
    mapId = 'aarhus_mid-01'
    polygon = @(
        @{lat=56.16025; lng=10.20995},
        @{lat=56.16065; lng=10.21045},
        @{lat=56.16045; lng=10.21095},
        @{lat=56.16005; lng=10.21055}
    )
}
$json = $zones | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output 'Illustrative mapping saved. It does not represent the supplied camera location.'
Write-Output 'Refresh the completed job in RoboOps to create the proposed incident. No new VLM request is needed.'
