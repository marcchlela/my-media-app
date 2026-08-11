$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$icons = Join-Path $PSScriptRoot 'icons'
$webIcons = Join-Path $root 'web\icons'
New-Item -ItemType Directory -Force -Path $icons, $webIcons | Out-Null
$edge = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $edge) { throw 'Microsoft Edge is required to export the MyFlix SVG artwork.' }

function Export-Png([string]$source, [string]$target, [int]$size, [bool]$transparent = $false) {
  $background = if ($transparent) { '00000000' } else { 'FFFFFFFF' }
  $sourceUrl = [System.Uri]::new($source).AbsoluteUri
  $profile = Join-Path $env:TEMP "myflix-icon-$([System.Guid]::NewGuid().ToString('N'))"
  $arguments = @(
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    "--user-data-dir=$profile", "--default-background-color=$background", "--window-size=$size,$size",
    "--screenshot=$target", $sourceUrl
  )
  try {
    $process = Start-Process -FilePath $edge -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0 -or -not (Test-Path $target)) { throw "Could not export $target" }
  } finally {
    if (Test-Path $profile) { Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

Export-Png (Join-Path $icons 'icon-general.svg') (Join-Path $icons 'icon-general-1024.png') 1024
Export-Png (Join-Path $icons 'icon-electric-lounge.svg') (Join-Path $icons 'icon-electric-lounge-1024.png') 1024
$webSource = if ($env:MYFLIX_WEB_ICON_VARIANT -eq 'electric') {
  Join-Path $icons 'icon-electric-lounge.svg'
} else {
  Join-Path $icons 'icon-general.svg'
}
Export-Png $webSource (Join-Path $webIcons 'icon-512.png') 512
Export-Png $webSource (Join-Path $webIcons 'icon-192.png') 192
Export-Png $webSource (Join-Path $webIcons 'apple-touch-icon.png') 180
Export-Png $webSource (Join-Path $webIcons 'favicon-32.png') 32
