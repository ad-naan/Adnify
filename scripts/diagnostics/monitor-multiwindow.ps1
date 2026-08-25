param(
  [ValidateRange(15, 3600)]
  [int]$DurationSeconds = 300,

  [ValidateRange(1, 30)]
  [int]$SampleIntervalSeconds = 2,

  [string]$OutputRoot = (Join-Path $PSScriptRoot '..\..\.tmp\adnify-diagnostics')
)

$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runStartedAt = Get-Date
$runId = $runStartedAt.ToString('yyyyMMdd-HHmmss')
$outputDir = Join-Path $OutputRoot $runId
$samplesPath = Join-Path $outputDir 'process-samples.csv'
$applicationEventsPath = Join-Path $outputDir 'application-events.csv'
$systemEventsPath = Join-Path $outputDir 'system-events.csv'
$summaryPath = Join-Path $outputDir 'summary.md'

New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

function Get-AdnifyDiagnosticProcesses {
  $processes = Get-Process -Name 'Adnify', 'electron', 'node' -ErrorAction SilentlyContinue
  $sampledAt = (Get-Date).ToString('o')
  foreach ($process in $processes) {
    $path = $null
    try { $path = $process.Path } catch { }

    $scope = if ($process.ProcessName -eq 'Adnify') {
      'packaged-app'
    } elseif ($process.ProcessName -eq 'electron' -and $path -and $path.StartsWith($workspaceRoot, [StringComparison]::OrdinalIgnoreCase)) {
      'workspace-electron'
    } elseif ($process.ProcessName -eq 'node') {
      'node-candidate'
    } else {
      'other-electron'
    }

    [pscustomobject]@{
      Timestamp = $sampledAt
      Scope = $scope
      ProcessName = $process.ProcessName
      Id = $process.Id
      WorkingSetMB = [math]::Round($process.WorkingSet64 / 1MB, 1)
      PrivateMemoryMB = [math]::Round($process.PrivateMemorySize64 / 1MB, 1)
      VirtualMemoryMB = [math]::Round($process.VirtualMemorySize64 / 1MB, 1)
      HandleCount = $process.HandleCount
      ThreadCount = $process.Threads.Count
      CPUSeconds = if ($null -eq $process.CPU) { $null } else { [math]::Round($process.CPU, 2) }
      Responding = $process.Responding
      Path = $path
    }
  }
}

function Export-RelevantEvents {
  param([datetime]$Since)

  Get-WinEvent -FilterHashtable @{
    LogName = 'Application'
    StartTime = $Since
    Id = @(1000, 1001, 1002)
  } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'Adnify|electron\.exe|node\.exe' } |
    Select-Object TimeCreated, Id, ProviderName, LevelDisplayName, Message |
    Export-Csv -LiteralPath $applicationEventsPath -NoTypeInformation -Encoding utf8

  Get-WinEvent -FilterHashtable @{
    LogName = 'System'
    StartTime = $Since
    Id = @(2004, 4101)
  } -ErrorAction SilentlyContinue |
    Select-Object TimeCreated, Id, ProviderName, LevelDisplayName, Message |
    Export-Csv -LiteralPath $systemEventsPath -NoTypeInformation -Encoding utf8
}

$loadScript = Join-Path $PSScriptRoot 'shell-load.mjs'
$loadCommand = "node `"$loadScript`" --duration 180 --output-kbps 128 --memory-mb 64"

Write-Host ''
Write-Host 'Adnify multi-window/Shell diagnostic monitor is running.' -ForegroundColor Cyan
Write-Host "Output: $outputDir"
Write-Host ''
Write-Host 'Open the desired Adnify windows, then run this command in one terminal per window:' -ForegroundColor Yellow
Write-Host $loadCommand -ForegroundColor White
Write-Host ''
Write-Host 'Press Ctrl+C to stop early. Existing processes will not be terminated.'

$allSamples = [System.Collections.Generic.List[object]]::new()
$appWasSeen = $false
$appDisappearedAt = $null
$deadline = $runStartedAt.AddSeconds($DurationSeconds)

try {
  while ((Get-Date) -lt $deadline) {
    $batch = @(Get-AdnifyDiagnosticProcesses)
    foreach ($sample in $batch) { $allSamples.Add($sample) }

    $appProcesses = @($batch | Where-Object { $_.Scope -in @('packaged-app', 'workspace-electron') })
    if ($appProcesses.Count -gt 0) {
      $appWasSeen = $true
    } elseif ($appWasSeen -and -not $appDisappearedAt) {
      $appDisappearedAt = Get-Date
      Write-Warning "All tracked Adnify processes disappeared at $($appDisappearedAt.ToString('o'))"
    }

    $electronPrivateMb = ($appProcesses | Measure-Object PrivateMemoryMB -Sum).Sum
    $nodePrivateMb = ($batch | Where-Object Scope -eq 'node-candidate' | Measure-Object PrivateMemoryMB -Sum).Sum
    Write-Progress -Activity 'Monitoring Adnify' -Status ("app private={0:N0} MB; node candidates={1:N0} MB" -f $electronPrivateMb, $nodePrivateMb) -PercentComplete ([math]::Min(100, ((Get-Date) - $runStartedAt).TotalSeconds / $DurationSeconds * 100))
    Start-Sleep -Seconds $SampleIntervalSeconds
  }
} finally {
  Write-Progress -Activity 'Monitoring Adnify' -Completed
  $allSamples | Export-Csv -LiteralPath $samplesPath -NoTypeInformation -Encoding utf8
  Export-RelevantEvents -Since $runStartedAt
}

$totals = $allSamples |
  Group-Object Timestamp |
  ForEach-Object {
    $appRows = @($_.Group | Where-Object { $_.Scope -in @('packaged-app', 'workspace-electron') })
    $nodeRows = @($_.Group | Where-Object Scope -eq 'node-candidate')
    [pscustomobject]@{
      AppWorkingSetMB = ($appRows | Measure-Object WorkingSetMB -Sum).Sum
      AppPrivateMemoryMB = ($appRows | Measure-Object PrivateMemoryMB -Sum).Sum
      AppProcessCount = $appRows.Count
      NodePrivateMemoryMB = ($nodeRows | Measure-Object PrivateMemoryMB -Sum).Sum
    }
  }

$maxAppWorkingSet = ($totals | Measure-Object AppWorkingSetMB -Maximum).Maximum
$maxAppPrivate = ($totals | Measure-Object AppPrivateMemoryMB -Maximum).Maximum
$maxAppProcessCount = ($totals | Measure-Object AppProcessCount -Maximum).Maximum
$maxNodePrivate = ($totals | Measure-Object NodePrivateMemoryMB -Maximum).Maximum
$applicationEventCount = @(Import-Csv -LiteralPath $applicationEventsPath -ErrorAction SilentlyContinue).Count
$systemEventCount = @(Import-Csv -LiteralPath $systemEventsPath -ErrorAction SilentlyContinue).Count
$runEndedAt = Get-Date

$summary = @"
# Adnify multi-window/Shell diagnostic summary

- Started: $($runStartedAt.ToString('o'))
- Ended: $($runEndedAt.ToString('o'))
- Workspace: $workspaceRoot
- App process observed: $appWasSeen
- All tracked app processes disappeared: $([bool]$appDisappearedAt)
- Disappearance time: $(if ($appDisappearedAt) { $appDisappearedAt.ToString('o') } else { 'n/a' })
- Maximum app process count: $maxAppProcessCount
- Maximum app working set: $([math]::Round($maxAppWorkingSet, 1)) MB
- Maximum app private memory: $([math]::Round($maxAppPrivate, 1)) MB
- Maximum private memory of Node candidates: $([math]::Round($maxNodePrivate, 1)) MB
- Relevant Application events: $applicationEventCount
- Relevant System events: $systemEventCount

## Files

- process-samples.csv: per-process memory, handles, threads, CPU and responsiveness
- application-events.csv: crash, WER and application-hang events
- system-events.csv: resource-exhaustion and display-driver events

## Interpretation

- A disappearance time plus no graceful shutdown log usually points to a native crash, OOM, or external termination.
- Application event 1000/1001/1002 identifies a crash, WER report, or hang.
- System event 2004 identifies virtual-memory exhaustion; 4101 identifies a display-driver reset.
- A single renderer or Node process growing steadily should be investigated before the aggregate total.
"@

Set-Content -LiteralPath $summaryPath -Value $summary -Encoding utf8
Write-Host ''
Write-Host "Diagnostic run complete: $summaryPath" -ForegroundColor Green
