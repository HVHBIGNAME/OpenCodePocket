@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $dir=Join-Path $env:TEMP ('occ-install-'+[guid]::NewGuid()); New-Item -ItemType Directory -Path $dir | Out-Null; try { $file=Join-Path $dir 'install-pocket.ps1'; Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.2/install-pocket.ps1' -OutFile $file; & $file } finally { Remove-Item -LiteralPath $dir -Recurse -Force }"
if errorlevel 1 echo Installation failed. Please copy the error above.
pause
