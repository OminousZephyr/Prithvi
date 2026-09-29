param(
  [Parameter(Mandatory = $true)] [string] $CameraBaseUrl,
  [Parameter(Mandatory = $true)] [string] $AiBaseUrl,
  [string] $OutputPath = '.\capture.jpg'
)

$CameraBaseUrl = $CameraBaseUrl.TrimEnd('/')
$AiBaseUrl = $AiBaseUrl.TrimEnd('/')
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

$status = Invoke-RestMethod "$CameraBaseUrl/camera-status" -TimeoutSec 15
if ($status.status -ne 'ok' -or $status.camera_initialized -ne $true) {
  throw 'Camera status did not report an initialized camera.'
}
$status | ConvertTo-Json -Depth 5

$capture = Invoke-WebRequest "$CameraBaseUrl/capture" -OutFile $OutputPath -PassThru -TimeoutSec 30
if ($capture.Headers['Content-Type'] -notlike 'image/jpeg*') {
  throw "Capture response is not JPEG (Content-Type: $($capture.Headers['Content-Type']))."
}
if ((Get-Item -LiteralPath $OutputPath).Length -le 0) {
  throw 'Capture response created an empty file.'
}
Write-Host "Saved real camera image to $OutputPath"

& curl.exe --fail -F "file=@$OutputPath;type=image/jpeg" "$AiBaseUrl/analyze"
if ($LASTEXITCODE -ne 0) {
  throw "FastAPI analyze request failed with curl exit code $LASTEXITCODE."
}
