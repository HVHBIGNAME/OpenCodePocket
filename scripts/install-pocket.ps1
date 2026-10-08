param([string]$BaseUrl = 'https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.1')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Download-Text([string]$Url) {
    $content = (Invoke-WebRequest -UseBasicParsing -Uri $Url).Content
    if ($content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($content) }
    return [string]$content
}

function Download-Checked([string]$Url, [string]$Destination, [string]$Expected) {
    $temporary = "$Destination.download"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary
        $stream = [IO.File]::OpenRead($temporary)
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            $actual = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha256.Dispose()
            $stream.Dispose()
        }
        if ($actual -ne $Expected.ToLowerInvariant()) { throw "Checksum mismatch: $Url" }
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

$config = if ($env:OPENCODE_CONFIG_DIR) { $env:OPENCODE_CONFIG_DIR } elseif ($env:XDG_CONFIG_HOME) { Join-Path $env:XDG_CONFIG_HOME 'opencode' } else { Join-Path $HOME '.config\opencode' }
$state = if ($env:OCC_STATE_DIR) { $env:OCC_STATE_DIR } else { Join-Path $config 'occ-pocket' }
$installer = Join-Path $state 'installer'
New-Item -ItemType Directory -Path $installer -Force | Out-Null
$node = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($node) { $node.Source } else { $null }
if (!$nodePath -and (Test-Path -LiteralPath (Join-Path $state 'runtime\node.exe'))) {
    $nodePath = Join-Path $state 'runtime\node.exe'
}
if ($nodePath) {
    $version = & $nodePath --version
    if ($LASTEXITCODE -ne 0 -or [int]$version.TrimStart('v').Split('.')[0] -lt 22) { $nodePath = $null }
}
if (!$nodePath) {
    $runtime = Join-Path $state 'runtime'
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $nodePath = Join-Path $runtime 'node.exe'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
    $base = 'https://nodejs.org/dist/latest-v24.x'
    $sums = Download-Text "$base/SHASUMS256.txt"
    $pattern = '(?m)^([a-f0-9]{64})\s+win-' + $arch + '/node\.exe\s*$'
    $match = [regex]::Match($sums, $pattern)
    if (!$match.Success) { throw 'Cannot find the official Node.js checksum' }
    Write-Host 'Downloading a private Node.js runtime...'
    Download-Checked "$base/win-$arch/node.exe" $nodePath $match.Groups[1].Value
}

Write-Host 'Downloading OpenCode Pocket...'
$checksums = Download-Text "$BaseUrl/SHA256SUMS.txt"
$files = @{
    'occ-pocket-cli.mjs' = 'cli.mjs'
    'occ-pocket-plugin.mjs' = 'plugin.js'
    'occ-pocket-tui.mjs' = 'tui.js'
}
foreach ($asset in $files.Keys) {
    $pattern = '(?m)^([a-f0-9]{64})\s+' + [regex]::Escape($asset) + '\s*$'
    $match = [regex]::Match($checksums, $pattern)
    if (!$match.Success) { throw "Missing release checksum: $asset" }
    Download-Checked "$BaseUrl/$asset" (Join-Path $installer $files[$asset]) $match.Groups[1].Value
}
& $nodePath (Join-Path $installer 'cli.mjs') install
if ($LASTEXITCODE -ne 0) { throw 'Pocket installation failed. See the error above.' }
Write-Host 'Installed. Restart OpenCode, then type /pocket-qr.'
