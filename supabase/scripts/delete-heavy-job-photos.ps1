# Deletes objects in bucket job-photos via Storage API (100 paths per batch).
# Run SQL block 2 (cleanup URLs) BEFORE this script.
#
# Env (required):
#   EXPO_PUBLIC_SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#
# Env (optional - if Windows cannot resolve *.supabase.co):
#   SUPABASE_RESOLVE_IP  e.g. 104.18.38.10  (nslookup YOURHOST.supabase.co 1.1.1.1)
#
# DEFINITIVE fix for DNS on this PC (pick one):
#   A) Wi-Fi adapter: set DNS IPv4 to 1.1.1.1 and 1.0.0.1, then ipconfig /flushdns
#   B) As Admin, edit C:\Windows\System32\drivers\etc\hosts and add one line:
#        104.18.38.10 kyehrxcdealbujvvnxp.supabase.co
#      (use an IP from nslookup against 1.1.1.1). Then flushdns.
#   C) Run this script from another network (phone hotspot) or another machine.
#
# If DNS works, do NOT set SUPABASE_RESOLVE_IP (uses Invoke-RestMethod).

$ErrorActionPreference = 'Stop'
$baseUrl = if ($env:EXPO_PUBLIC_SUPABASE_URL) { $env:EXPO_PUBLIC_SUPABASE_URL.TrimEnd('/') } else { $null }
$key = if ($env:SUPABASE_SERVICE_ROLE_KEY) { $env:SUPABASE_SERVICE_ROLE_KEY.Trim() } else { $null }
if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($key)) {
  throw 'Set EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this session.'
}

# Kong returns plain text "Project not specified" if apikey is not a legacy JWT it can decode (ref claim).
# New keys sb_secret_ / sb_publishable_ do NOT work here; use Legacy "service_role" JWT from Dashboard.
if ($key.StartsWith('sb_', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'SUPABASE_SERVICE_ROLE_KEY looks like a new-format key (sb_*). Use the LEGACY service_role JWT: Dashboard > Settings > API > Legacy API Keys > service_role (long eyJ... token).'
}
$jwtParts = $key -split '\.'
if ($jwtParts.Count -lt 3) {
  throw 'SUPABASE_SERVICE_ROLE_KEY must be a JWT with two dots (eyJ...). Paste the full legacy service_role from the dashboard.'
}

$resolveIp = if ($env:SUPABASE_RESOLVE_IP) { $env:SUPABASE_RESOLVE_IP.Trim() } else { $null }
$useCurl = -not [string]::IsNullOrWhiteSpace($resolveIp)
if ($useCurl) {
  if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) {
    throw 'SUPABASE_RESOLVE_IP is set but curl.exe was not found in PATH.'
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pathsFile = Join-Path $scriptDir 'paths.txt'
if (-not (Test-Path -LiteralPath $pathsFile)) {
  throw "Missing paths.txt in $scriptDir - create it from SQL block 3 (one path per line)."
}

# Force array (Get-Content with one line returns a string, not array).
$paths = @(
  Get-Content -LiteralPath $pathsFile -Encoding UTF8 |
  ForEach-Object {
    $line = $_.Trim().Trim([char]0xFEFF)
    if ($line.Length -ge 2 -and $line.StartsWith('"') -and $line.EndsWith('"')) {
      $line = $line.Substring(1, $line.Length - 2)
    }
    $line
  } |
  Where-Object { $_ -ne '' }
)
if ($paths.Count -eq 0) { throw 'paths.txt is empty.' }

# Supabase expects {"prefixes":["a","b"]}. PS 5.1 ConvertTo-Json can break arrays; build JSON by hand.
function Build-RemoveBodyJson([string[]]$batch) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($p in $batch) {
    if ([string]::IsNullOrEmpty($p)) { continue }
    $s = $p.Replace('\', '\\').Replace('"', '\"').Replace("`r", '').Replace("`n", '')
    [void]$parts.Add('"' + $s + '"')
  }
  return '{"prefixes":[' + ($parts -join ',') + ']}'
}

$uri = "$baseUrl/storage/v1/object/job-photos"
$hostOnly = ([Uri]$baseUrl).Host
if ([string]::IsNullOrWhiteSpace($hostOnly)) {
  throw 'Could not parse host from EXPO_PUBLIC_SUPABASE_URL.'
}

function Invoke-DeleteBatchCurlStdin {
  param([string]$JsonBody)
  # JSON on stdin (@-). Response body saved to temp file so we can show API errors on 4xx.
  $curl = (Get-Command curl.exe).Source
  $respFile = Join-Path $env:TEMP ('sb-del-resp-' + [Guid]::NewGuid().ToString('n') + '.txt')
  $respFileCurl = $respFile -replace '\\', '/'
  $uriCurl = $uri -replace '\\', '/'
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $curl
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $d = [char]34
  $psi.Arguments = (
    "--resolve ${d}${hostOnly}:443:${resolveIp}${d} " +
    "-sS -o ${d}$respFileCurl${d} -w %{http_code} -X DELETE ${d}$uriCurl${d} " +
    "-H ${d}apikey: $key${d} " +
    "-H ${d}Authorization: Bearer $key${d} " +
    "-H ${d}Content-Type: application/json; charset=utf-8${d} " +
    "-H ${d}Host: $hostOnly${d} " +
    '--http1.1 ' +
    '--data-binary @-'
  )

  $p = New-Object System.Diagnostics.Process
  $p.StartInfo = $psi
  [void]$p.Start()
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $bytes = $utf8.GetBytes($JsonBody)
  $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
  $p.StandardInput.Close()
  $stdout = $p.StandardOutput.ReadToEnd()
  $stderr = $p.StandardError.ReadToEnd()
  $p.WaitForExit()
  $code = $stdout.Trim()
  try {
    if ($p.ExitCode -ne 0) {
      throw "curl exit $($p.ExitCode): $stderr"
    }
    if ($code -notmatch '^2\d\d$') {
      $detail = ''
      if (Test-Path -LiteralPath $respFile) {
        $detail = (Get-Content -LiteralPath $respFile -Raw -ErrorAction SilentlyContinue)
        if ($detail.Length -gt 800) { $detail = $detail.Substring(0, 800) + '...' }
      }
      throw "HTTP $code from curl DELETE. stderr=$stderr body=$detail"
    }
  }
  finally {
    if (Test-Path -LiteralPath $respFile) { Remove-Item -LiteralPath $respFile -Force -ErrorAction SilentlyContinue }
  }
}

function Invoke-DeleteBatch {
  param([string]$JsonBody)
  if ($useCurl) {
    Invoke-DeleteBatchCurlStdin -JsonBody $JsonBody
  }
  else {
    $headers = @{
      apikey         = $key
      Authorization = "Bearer $key"
    }
    Invoke-RestMethod -Method Delete -Uri $uri -Headers $headers -ContentType 'application/json; charset=utf-8' -Body $JsonBody | Out-Null
  }
}

if (-not $useCurl) {
  Write-Host 'Tip: if DNS fails, set SUPABASE_RESOLVE_IP or fix hosts / Wi-Fi DNS (see script header).' -ForegroundColor Yellow
}

$batchSize = 100
$ok = 0
for ($i = 0; $i -lt $paths.Count; $i += $batchSize) {
  $batch = @($paths[$i..([Math]::Min($i + $batchSize - 1, $paths.Count - 1))])
  $body = Build-RemoveBodyJson -batch $batch
  try {
    Invoke-DeleteBatch -JsonBody $body
    $n = $batch.Count
    $ok += $n
    Write-Host ('OK batch: rows {0}-{1}, count={2}' -f ($i + 1), ($i + $n), $n) -ForegroundColor Green
  }
  catch {
    Write-Host ('Error at batch starting index {0}: {1}' -f $i, $_) -ForegroundColor Red
    throw
  }
}

Write-Host ('Done. Delete requests sent for {0} paths.' -f $ok) -ForegroundColor Cyan
