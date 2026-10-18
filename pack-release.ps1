param([string]$Stage,[string]$Archive)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$Stage=[IO.Path]::GetFullPath($Stage).TrimEnd('\')
$stream=[IO.File]::Open($Archive,[IO.FileMode]::Create)
$zip=New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try{foreach($file in Get-ChildItem -LiteralPath $Stage -Recurse -Force -File){$relative=$file.FullName.Substring($Stage.Length+1).Replace('\','/');[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,$file.FullName,$relative,[IO.Compression.CompressionLevel]::Optimal) | Out-Null}}finally{$zip.Dispose();$stream.Dispose()}
