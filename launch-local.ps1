param(
  [string]$ApiKey,
  [int]$Port = 3010,
  [switch]$OpenChrome
)

$resolvedApiKey = if ($ApiKey) { $ApiKey } else { $env:NVIDIA_API_KEY }

if (-not $resolvedApiKey) {
  throw "Missing API key. Pass -ApiKey or set NVIDIA_API_KEY in your environment."
}

$escapedApiKey = $resolvedApiKey.Replace("'", "''")
$escapedRoot = $PSScriptRoot.Replace("'", "''")
$stdout = Join-Path $PSScriptRoot "launch-server.out.log"
$stderr = Join-Path $PSScriptRoot "launch-server.err.log"

Remove-Item $stdout, $stderr -ErrorAction SilentlyContinue

$serverCommand = @"
`$env:NVIDIA_API_KEY = '$escapedApiKey'
`$env:PORT = '$Port'
Set-Location -LiteralPath '$escapedRoot'
node server.js
"@

$process = Start-Process pwsh `
  -ArgumentList '-NoProfile', '-Command', $serverCommand `
  -WorkingDirectory $PSScriptRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -PassThru

Start-Sleep -Seconds 4

$url = "http://localhost:$Port"
if (Test-Path $stdout) {
  $logText = Get-Content $stdout | Out-String
  $match = [regex]::Match($logText, 'http://localhost:(\d+)')
  if ($match.Success) {
    $url = "http://localhost:$($match.Groups[1].Value)"
  }
}

if ($OpenChrome) {
  $chromePaths = @(
    "chrome",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
  )

  foreach ($chrome in $chromePaths) {
    try {
      Start-Process $chrome $url -ErrorAction Stop | Out-Null
      break
    } catch {}
  }
}

Write-Output "Server PID: $($process.Id)"
Write-Output "URL: $url"
