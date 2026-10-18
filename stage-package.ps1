param([Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip=[IO.Compression.ZipFile]::OpenRead($Archive)
try{
  if($zip.Entries.Count -gt 400){throw 'Too many ZIP entries'}
  $total=0L;$names=@{}
  foreach($entry in $zip.Entries){
    $name=$entry.FullName.Replace('\','/');$total+=$entry.Length
    if($total -gt 150MB){throw 'Expanded package too large'}
    if($name -notlike 'opencode-monitor/*' -or $name -match '(^|/)\.\.?(/|$)|:|^/' -or $name -match '^opencode-monitor/(data|seed|runtime|node_modules|\.git)(/|$)|^opencode-monitor/config\.json$'){throw 'Unsafe ZIP entry'}
    if((($entry.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'ZIP symbolic links are not accepted'}
    if($names.ContainsKey($name.ToLowerInvariant())){throw 'Duplicate ZIP entry'};$names[$name.ToLowerInvariant()]=$true
    $resolved=[IO.Path]::GetFullPath((Join-Path $Destination $name))
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($Destination).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'ZIP entry escapes directory'}
  }
}finally{$zip.Dispose()}
New-Item -ItemType Directory -Path $Destination | Out-Null
[IO.Compression.ZipFile]::ExtractToDirectory($Archive,$Destination)
