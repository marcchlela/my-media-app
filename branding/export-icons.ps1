$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'mobile-client\assets'
$webIcons = Join-Path $root 'web\icons'
New-Item -ItemType Directory -Force -Path $assets, $webIcons | Out-Null
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

Export-Png (Join-Path $PSScriptRoot 'icon-general.svg') (Join-Path $assets 'icon-general-1024.png') 1024
Export-Png (Join-Path $PSScriptRoot 'icon-electric-lounge.svg') (Join-Path $assets 'icon-electric-lounge-1024.png') 1024
Export-Png (Join-Path $PSScriptRoot 'adaptive-foreground.svg') (Join-Path $assets 'adaptive-icon-foreground.png') 1024 $true
Export-Png (Join-Path $PSScriptRoot 'adaptive-monochrome.svg') (Join-Path $assets 'adaptive-icon-monochrome.png') 1024 $true
Export-Png (Join-Path $PSScriptRoot 'splash-icon.svg') (Join-Path $assets 'splash-icon.png') 512 $true
$webSource = if ($env:MYFLIX_WEB_ICON_VARIANT -eq 'electric') {
  Join-Path $PSScriptRoot 'icon-electric-lounge.svg'
} else {
  Join-Path $PSScriptRoot 'icon-general.svg'
}
Export-Png $webSource (Join-Path $webIcons 'icon-512.png') 512
Export-Png $webSource (Join-Path $webIcons 'icon-192.png') 192
Export-Png $webSource (Join-Path $webIcons 'apple-touch-icon.png') 180
Export-Png $webSource (Join-Path $webIcons 'favicon-32.png') 32
