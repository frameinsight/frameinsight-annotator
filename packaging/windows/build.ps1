param(
    [string]$MingwBin = 'C:\msys64\ucrt64\bin',
    [string]$Nsis = 'C:\Program Files (x86)\NSIS\makensis.exe',
    [switch]$SkipFrontend
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$env:Path = "$MingwBin;$env:Path"
Set-Location (Join-Path $PSScriptRoot '../..')
$build = Join-Path (Get-Location) '.frameinsight/windows-build'
New-Item -ItemType Directory -Force "$build/wheels" | Out-Null
python -m pip download --only-binary=:all: --platform win_amd64 --python-version 3.13 --implementation cp --abi cp313 -d "$build/wheels" -r packaging/windows/requirements.txt
if (-not $SkipFrontend) { npm --prefix frontend run build }
python packaging/windows/prepare.py
Push-Location $build
try {
    & "$MingwBin/windres.exe" launcher.rc launcher-res.o
    & "$MingwBin/gcc.exe" -municode -mwindows -O2 -s -static-libgcc launcher.c launcher-res.o -o payload/Frameinsight.exe -lshell32 -lole32
    & $Nsis /V2 installer.nsi
} finally { Pop-Location }
New-Item -ItemType Directory -Force deliverables/windows | Out-Null
Copy-Item "$build/output/Window_setup.exe" deliverables/windows/Window_setup.exe -Force
Copy-Item "$build/payload/START-HERE.txt" deliverables/windows/START-HERE.txt -Force
$hash = (Get-FileHash deliverables/windows/Window_setup.exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  deliverables/windows/Window_setup.exe" | Set-Content -Encoding utf8 deliverables/windows/SHA256SUMS.txt
