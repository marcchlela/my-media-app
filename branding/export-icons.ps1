$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $PSScriptRoot 'icons'
$webIcons = Join-Path $root 'web\icons'
New-Item -ItemType Directory -Force -Path $icons, $webIcons | Out-Null
Add-Type -AssemblyName System.Drawing
$edge = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge is required to export the MyFlix SVG artwork.' }

function Export-SvgMaster([string]$source, [string]$target) {
  $profile = Join-Path $env:TEMP "myflix-icon-$([System.Guid]::NewGuid().ToString('N'))"
  $document = Join-Path $env:TEMP "myflix-icon-$([System.Guid]::NewGuid().ToString('N')).html"
  $svg = [System.IO.File]::ReadAllText($source)
  $html = @"
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
    body { display: grid; place-items: center; }
    svg { display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%; }
  </style>
</head>
<body>$svg</body>
</html>
"@
  [System.IO.File]::WriteAllText($document, $html, [System.Text.UTF8Encoding]::new($false))
  $documentUrl = [System.Uri]::new($document).AbsoluteUri
  $arguments = @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw', "--user-data-dir=$profile", '--window-size=1024,1024',
    "--screenshot=$target", $documentUrl
  )
  try {
    $process = Start-Process -FilePath $edge -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path $target)) { throw "Could not export $target" }
  } finally {
    if (Test-Path $profile) { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $document -Force -ErrorAction SilentlyContinue
  }
}

function Resize-Png([string]$source, [string]$target, [int]$size) {
  $sourceImage = [System.Drawing.Image]::FromFile($source)
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($sourceImage, [System.Drawing.Rectangle]::new(0, 0, $size, $size))
    $bitmap.Save($target, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
    $sourceImage.Dispose()
  }
}

$generalMaster = Join-Path $icons 'icon-general-1024.png'
$electricMaster = Join-Path $icons 'icon-electric-lounge-1024.png'
Export-SvgMaster (Join-Path $icons 'icon-general.svg') $generalMaster
Export-SvgMaster (Join-Path $icons 'icon-electric-lounge.svg') $electricMaster
$webMaster = if ($env:MYFLIX_WEB_ICON_VARIANT -eq 'electric') {
  $electricMaster
} else {
  $generalMaster
}
Resize-Png $webMaster (Join-Path $webIcons 'icon-512.png') 512
Resize-Png $webMaster (Join-Path $webIcons 'icon-192.png') 192
Resize-Png $webMaster (Join-Path $webIcons 'apple-touch-icon-v2.png') 180
Resize-Png $webMaster (Join-Path $webIcons 'favicon-32.png') 32
