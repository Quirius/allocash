# Dot-source from PowerShell: . .\scripts\use-local-tools.ps1
# Uses only tools already downloaded into this checkout; installs nothing.
$allocashRoot = Split-Path -Parent $PSScriptRoot
$allocashTools = Join-Path $allocashRoot '.tools'
$allocashBins = @(
    (Join-Path $allocashTools 'node-v24.21.0-win-x64'),
    (Join-Path $allocashTools 'cargo\bin'),
    (Join-Path $allocashTools 'w64devkit\bin')
) | Where-Object { Test-Path -LiteralPath $_ }
$env:PATH = ($allocashBins -join ';') + ';' + $env:PATH
$env:CARGO_HOME = Join-Path $allocashTools 'cargo'
$env:RUSTUP_HOME = Join-Path $allocashTools 'rustup'
# Rust supplies its matching GNU runtime libraries; w64devkit compiles SQLite C.
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS = '-C link-self-contained=yes'
$env:TEMP = Join-Path $allocashTools 'tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
