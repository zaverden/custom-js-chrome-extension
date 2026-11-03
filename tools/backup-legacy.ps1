param([string]$Destination = "$env:USERPROFILE\Documents\CustomJS-MV3-backups\$(Get-Date -Format yyyyMMdd-HHmmss)")
$ErrorActionPreference='Stop'
$profile="$env:LOCALAPPDATA\Yandex\YandexBrowser\User Data\Default"
$id='ddbjnfjiigjmcpcpkmhogomapikjbjdk'
if(Test-Path $Destination){throw 'Choose a new backup directory; existing backups are never overwritten.'}
New-Item -ItemType Directory -Path $Destination | Out-Null
function SharedHash([string]$Path){
 $stream=[IO.File]::Open($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
 $sha=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-','')}finally{$stream.Dispose();$sha.Dispose()}
}
$inventory=@()
foreach($kind in @('Local Extension Settings','Sync Extension Settings')) {
 $source=Join-Path (Join-Path $profile $kind) $id
 $target=Join-Path $Destination $kind
 New-Item -ItemType Directory -Path $target | Out-Null
 & robocopy.exe $source $target /E /COPY:DAT /R:0 /W:0 /NFL /NDL /NJH /NJS /NP | Out-Null
 if($LASTEXITCODE -gt 7){throw "Copy failed for $kind; no export may proceed."}
 foreach($file in (Get-ChildItem $source -File -Recurse)) {
  $relative=$file.FullName.Substring($source.Length+1)
  if($file.Name -eq 'LOCK'){continue}
  $original=(SharedHash $file.FullName)
  $copy=(SharedHash (Join-Path $target $relative))
  if($original -ne $copy){throw 'Storage changed during copy; retry backup after a normal browser exit.'}
  $inventory+=@{area=$kind;file=$relative;sha256=$copy;bytes=$file.Length}
 }
}
$manifest=Get-ChildItem "$profile\Extensions\$id" -Filter manifest.json -Recurse | Select-Object -First 1
if(!$manifest){throw 'Original installed manifest was not found.'}
Copy-Item $manifest.FullName "$Destination\original-manifest.json"
$inventory | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 "$Destination\backup-integrity.json"
Write-Output "Backup ready: $Destination"
exit 0
