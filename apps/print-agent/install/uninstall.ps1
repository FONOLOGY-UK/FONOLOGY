<#
    Removes the Fonology print agent.

    DELIBERATELY LEAVES THE DATA FOLDER BEHIND. It holds the logs and — more
    importantly — any crash markers. A marker is the record that a receipt may
    have printed, and deleting it silently discards a question that a person
    still needs to answer. Uninstalling should not be able to lose that.

    The folder is named in the output so anyone who genuinely wants it gone can
    delete it themselves, deliberately.
#>

$ErrorActionPreference = 'Stop'

$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Fonology Print Agent'
$StateDir = Join-Path $env:ProgramData 'Fonology\PrintAgent'
$TaskName = 'Fonology Print Agent'

Write-Host ''
Write-Host '  Removing the Fonology print agent' -ForegroundColor Cyan
Write-Host ''

# See install.ps1 for why native calls go through this: schtasks writes to
# stderr for ordinary "not found" answers, which would otherwise abort us.
function Invoke-Native {
    param([string]$Exe, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Exe @Arguments 2>&1 | Out-String
        return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
    } finally {
        $ErrorActionPreference = $previous
    }
}

$query = Invoke-Native schtasks.exe @('/Query', '/TN', $TaskName)
if ($query.ExitCode -eq 0) {
    Invoke-Native schtasks.exe @('/End', '/TN', $TaskName) | Out-Null
    Start-Sleep -Seconds 2
    Invoke-Native schtasks.exe @('/Delete', '/TN', $TaskName, '/F') | Out-Null
    Write-Host '  Scheduled task removed.' -ForegroundColor Green
} else {
    Write-Host '  No scheduled task was registered.' -ForegroundColor Gray
}

# Only processes running from OUR install folder. A blanket "stop node" would
# take out whatever else the machine happens to be running.
#
# Matched on the COMMAND LINE, not the executable path: the agent runs as
# "<system node.exe> <installdir>\dist\index.js", so its Path is the shared
# system copy of Node. Filtering on Path matched nothing, and the uninstaller
# silently left the agent running — verified, and then fixed.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$InstallDir*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like '*run-agent.vbs*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host '  Program files removed.' -ForegroundColor Green
}

Write-Host ''
Write-Host '  Left in place on purpose:' -ForegroundColor Yellow
Write-Host "    $StateDir"
Write-Host '    (logs, settings, and any record of prints that were interrupted)'
Write-Host ''
