# Store a model provider key in the local .env and the worker's deploy env,
# then ship the worker. The key is read without echo and never printed.
#
#   .\scripts\set-model-key.ps1                    # ANTHROPIC_API_KEY, ships afterwards
#   .\scripts\set-model-key.ps1 -Name OPENROUTER_API_KEY
#   .\scripts\set-model-key.ps1 -NoShip
param(
  [string]$Name = "ANTHROPIC_API_KEY",
  [switch]$NoShip
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$files = @((Join-Path $root ".env"), (Join-Path $root "deploy\worker\.env.deploy"))

$secure = Read-Host "Paste $Name (input hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
$key = $key.Trim()
if ($key.Length -lt 20) { throw "that does not look like a key (too short)" }

foreach ($f in $files) {
  if (-not (Test-Path $f)) { New-Item -ItemType File -Path $f -Force | Out-Null }
  $lines = Get-Content $f -ErrorAction SilentlyContinue
  $kept = @($lines | Where-Object { $_ -notmatch "^\s*$Name\s*=" })
  $kept += "$Name=$key"
  Set-Content -Path $f -Value $kept -Encoding utf8
  Write-Host "stored $Name in $f"
}
$key = $null

if ($NoShip) { exit 0 }
Write-Host "shipping the worker to the droplet..."
Push-Location (Join-Path $root "deploy\worker")
try { & (Join-Path $root "hive.exe") ship --driver droplet } finally { Pop-Location }
Write-Host "done. Restart the local worker too if it is running (Ctrl+C, then hive company run --group companies --port 4700)."
