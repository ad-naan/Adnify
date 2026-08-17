# Adnify shell integration for Windows PowerShell and PowerShell 7.
# This follows the VS Code OSC 633 model: shell lifecycle hooks report command
# boundaries while the terminal remains a normal interactive shell.

$Global:__AdnifyCommandRunning = $false
$Global:__AdnifyOriginalPrompt = $function:prompt
$Global:__AdnifyOriginalPSConsoleHostReadLine = $function:PSConsoleHostReadLine

function Global:__Adnify-EmitShellIntegration([string]$Phase, [string]$Payload = '') {
    $sequence = if ($Payload.Length -eq 0) {
        "$([char]27)]633;$Phase$([char]7)"
    } else {
        "$([char]27)]633;$Phase;$Payload$([char]7)"
    }
    [Console]::Out.Write($sequence)
}

function Global:PSConsoleHostReadLine {
    $command = if ($null -ne $Global:__AdnifyOriginalPSConsoleHostReadLine) {
        & $Global:__AdnifyOriginalPSConsoleHostReadLine
    } else {
        & ([ScriptBlock]::Create((
            'param($runspace, $context) [Microsoft.PowerShell.PSConsoleReadLine]::ReadLine($runspace, $context)'
        ))) $Host.Runspace $ExecutionContext
    }

    # Empty submissions should not start a command lifecycle. A real command
    # resets LASTEXITCODE so a stale native exit code cannot leak into the
    # result of a later cmdlet-only command.
    if (-not [string]::IsNullOrWhiteSpace($command)) {
        $Global:LASTEXITCODE = $null
        $Global:__AdnifyCommandRunning = $true
        __Adnify-EmitShellIntegration 'C'
    }

    return $command
}

function Global:prompt {
    if ($Global:__AdnifyCommandRunning) {
        $succeeded = $?
        $nativeExitCode = $LASTEXITCODE
        $exitCode = if ($succeeded) {
            if ($null -ne $nativeExitCode) { $nativeExitCode } else { 0 }
        } elseif ($null -ne $nativeExitCode -and $nativeExitCode -ne 0) {
            $nativeExitCode
        } else {
            1
        }

        $Global:__AdnifyCommandRunning = $false
        __Adnify-EmitShellIntegration 'D' "$exitCode"
    }

    __Adnify-EmitShellIntegration 'A'
    if ($null -ne $Global:__AdnifyOriginalPrompt) {
        & $Global:__AdnifyOriginalPrompt
    } else {
        'PS> '
    }
}

$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
__Adnify-EmitShellIntegration 'P' 'Adnify;1'
