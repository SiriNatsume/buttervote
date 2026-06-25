param(
  [ValidateSet("site", "cron")]
  [string]$Target = "site",
  [switch]$DryRun,
  [switch]$UseProxy
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

if (-not $UseProxy) {
  @("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy") |
    ForEach-Object { Remove-Item "Env:\$_" -ErrorAction SilentlyContinue }
}

if (-not $env:WRANGLER_LOG_PATH) {
  $wranglerLogDir = Join-Path $RepoRoot ".wrangler\logs"
  New-Item -ItemType Directory -Force -Path $wranglerLogDir | Out-Null
  $env:WRANGLER_LOG_PATH = $wranglerLogDir
}

function Get-DotenvValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path $Path)) {
    return $null
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ($trimmed -eq "" -or $trimmed.StartsWith("#")) {
      continue
    }
    if ($trimmed -match "^$([regex]::Escape($Key))\s*=\s*(.*)$") {
      $value = $Matches[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      if ($value -eq "") {
        return $null
      }
      return $value
    }
  }

  return $null
}

$dotenvPath = Join-Path $RepoRoot ".env"
@("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN") | ForEach-Object {
  if (-not [Environment]::GetEnvironmentVariable($_, "Process")) {
    $dotenvValue = Get-DotenvValue $dotenvPath $_
    if ($dotenvValue) {
      Set-Item "Env:\$_" $dotenvValue
    }
  }
}

if (-not $env:CLOUDFLARE_ACCOUNT_ID) {
  Write-Warning "CLOUDFLARE_ACCOUNT_ID is not set. If your Cloudflare token cannot list accounts, Wrangler will fail before deploy."
}

try {
  if ($Target -eq "site") {
    Push-Location $RepoRoot
    npx opennextjs-cloudflare build
  } else {
    Push-Location (Join-Path $RepoRoot "cloudflare-cron-worker")
  }

  if ($DryRun) {
    npx wrangler deploy --dry-run
  } else {
    npx wrangler deploy
  }
} finally {
  Pop-Location
}
