# Live monitor script for running Adnify processes
param([int]$DurationSeconds = 5)

$processes = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'Adnify.exe' }
if (-not $processes) {
    Write-Host "No running Adnify.exe processes found!" -ForegroundColor Red
    exit 1
}

$roleMap = @{}
foreach ($proc in $processes) {
    $role = "Main Process"
    $cmd = $proc.CommandLine
    if ($cmd -match '--type=renderer') { $role = "Renderer (UI)" }
    elseif ($cmd -match '--type=gpu-process') { $role = "GPU Process" }
    elseif ($cmd -match '--type=utility') {
        if ($cmd -match 'node\.mojom\.NodeService') { $role = "Utility (Node Service)" }
        elseif ($cmd -match 'network\.mojom') { $role = "Utility (Network)" }
        else { $role = "Utility Process" }
    }
    elseif ($cmd -match 'tsserver') { $role = "TypeScript Server (tsserver)" }
    elseif ($cmd -match 'typescript-language-server') { $role = "LSP Server (TypeScript)" }
    elseif ($cmd -match 'vscode-css') { $role = "CSS Language Server" }
    elseif ($cmd -match 'typingsInstaller') { $role = "Typings Installer" }
    $roleMap[$proc.ProcessId] = $role
}

Write-Host "Monitoring $( $processes.Count ) Adnify processes for $DurationSeconds seconds..." -ForegroundColor Cyan

$pids = $processes.ProcessId
$p1 = Get-Process -Id $pids -ErrorAction SilentlyContinue

# Sample GPU counters for these PIDs if possible
$gpuCounterPaths = foreach ($id in $pids) {
    "\GPU Engine(pid_${id}_*)\Utilization Percentage"
}

Start-Sleep -Seconds $DurationSeconds

$p2 = Get-Process -Id $pids -ErrorAction SilentlyContinue

$results = [System.Collections.Generic.List[PSCustomObject]]::new()
$cpuCores = [Environment]::ProcessorCount

foreach ($proc in $p2) {
    $before = $p1 | Where-Object { $_.Id -eq $proc.Id }
    if ($before) {
        $cpuSec = $proc.CPU - $before.CPU
        # Normalize to 0-100% of single core or total CPU
        $cpuPctTotal = [math]::Round(($cpuSec / ($DurationSeconds * $cpuCores)) * 100, 2)
        $cpuPctCore = [math]::Round(($cpuSec / $DurationSeconds) * 100, 1)
        $memMB = [math]::Round($proc.WorkingSet64 / 1MB, 1)
        $role = if ($roleMap.ContainsKey($proc.Id)) { $roleMap[$proc.Id] } else { "Adnify" }

        $results.Add([PSCustomObject]@{
            PID = $proc.Id
            Role = $role
            CPU_Core_Pct = $cpuPctCore
            CPU_Total_Pct = $cpuPctTotal
            Memory_MB = $memMB
        })
    }
}

Write-Host "`n=== LIVE ADNIFY RESOURCE USAGE (Over $DurationSeconds s window) ===" -ForegroundColor Green
$results | Sort-Object CPU_Core_Pct -Descending | Format-Table -Property PID, Role, CPU_Core_Pct, CPU_Total_Pct, Memory_MB -AutoSize

$totalCoreCPU = ($results | Measure-Object -Property CPU_Core_Pct -Sum).Sum
$totalMem = ($results | Measure-Object -Property Memory_MB -Sum).Sum
Write-Host "Total CPU across all cores: $([math]::Round($totalCoreCPU, 1))% (of 1 core) | $([math]::Round($totalCoreCPU / $cpuCores, 2))% total system" -ForegroundColor Yellow
Write-Host "Total Memory Working Set:   $([math]::Round($totalMem, 1)) MB" -ForegroundColor Yellow
