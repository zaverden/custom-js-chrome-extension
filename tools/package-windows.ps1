param([string]$Name='customjs-mv3')
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$build=Join-Path $root 'build'
if(!(Test-Path "$build\manifest.json")){throw 'Run npm run build first.'}
$version=(Get-Content "$build\manifest.json" -Raw | ConvertFrom-Json).version
$dist=Join-Path $root 'dist'
$target=Join-Path $dist $Name
New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item "$build\*" $target -Recurse -Force
Copy-Item "$root\LICENSE" $target -Force
Copy-Item "$root\README.md" "$target\INSTALL.md" -Force
Copy-Item "$root\README.md" "$dist\INSTALL.md" -Force
$zip=Join-Path $dist "$Name-$version.zip"
Compress-Archive -Path $target -DestinationPath $zip -Force
$hash=Get-FileHash $zip -Algorithm SHA256
"$($hash.Hash.ToLower())  $([IO.Path]::GetFileName($zip))" | Set-Content -Encoding ASCII (Join-Path $dist 'SHA256SUMS.txt')
$hash | Format-List
Write-Output "Load unpacked extension from: $target"
