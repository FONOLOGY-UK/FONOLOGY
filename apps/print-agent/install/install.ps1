<#
    Fonology print agent — installer.
    =========================================================================
    Installs the agent onto a till PC and makes it start by itself at logon.

    WHY A SCHEDULED TASK AND NOT A WINDOWS SERVICE
    A LocalSystem service runs in Session 0, which is isolated from user
    sessions, and services in that context have well-documented problems seeing
    printers installed in a user session. BOTH printers in this design go
    through the Windows print subsystem, so a service is the wrong container —
    it would be the more "professional" choice and it would not print.

    So: a Scheduled Task, triggered at logon, running as the till user.

    NO AUTO-LOGIN IS NEEDED. An earlier draft of this required the PC to log
    in automatically. The client's actual routine makes that unnecessary:
    "we log out every night once we leave and when we come back in we log back
    in, an on and off system". Staff logging in each morning IS the trigger,
    which is exactly what a logon-triggered task wants. The agent is offline
    overnight by design, and the admin screen reports it as "asleep" rather
    than "not responding" because health is evaluated against the shop's
    opening hours.

    NO ADMINISTRATOR RIGHTS ARE REQUIRED. Program files go under the user's
    LOCALAPPDATA, shared state goes under ProgramData (standard users may
    create folders there), and a task registered in the user's own context
    needs no elevation.

    WHAT MAKES IT SURVIVE
    The logon trigger repeats every 10 minutes, forever. That is not a
    workaround for a flaky agent — it is a watchdog that costs nothing,
    because the agent already refuses to start twice (it holds a localhost
    port as a lock). A repeat launch while the agent is healthy exits in
    milliseconds; a repeat launch after a crash brings it back within ten
    minutes, with nobody in the shop having to do anything.
#>

[CmdletBinding()]
param(
    # Supplying these makes the install fully unattended, which is how a second
    # machine gets set up without anyone reading a prompt.
    [string]$Token,
    [string]$ApiUrl,
    [string]$NodeExe
)

$ErrorActionPreference = 'Stop'

# The API the agent talks to. Presented as the default at the prompt so the
# usual install is one paste and two Enters.
$DefaultApiUrl = 'https://api.fonology.co.uk'

$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\Fonology Print Agent'
$StateDir = Join-Path $env:ProgramData 'Fonology\PrintAgent'
$TaskName = 'Fonology Print Agent'
$SourceDir = Split-Path -Parent $PSScriptRoot

<#
    Run a native .exe without letting its stderr abort the script.

    Windows PowerShell 5.1 wraps every stderr line from a native program in a
    NativeCommandError record, and with $ErrorActionPreference = 'Stop' that
    terminates the script. schtasks.exe writes to stderr for the entirely
    normal case of "that task does not exist yet" — so the first install would
    die on the check for a previous install. Found by running this installer,
    not by reading it.

    Exit codes are what we actually want to branch on, so this returns one.
#>
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

<#
    Stop any agent running from this install folder.

    MATCHES ON THE COMMAND LINE, NOT THE EXECUTABLE PATH. The agent runs as
    "C:\Program Files\nodejs\node.exe <installdir>\dist\index.js", so the
    process's own Path is the system copy of Node — shared with anything else
    on the machine. Matching on Path either killed nothing (the bug this
    replaces: a reinstall left the old agent holding the lock, and the fresh
    one exited immediately) or, with a looser filter, would have killed every
    unrelated Node process on the PC.
#>
function Stop-AgentProcesses([string]$Dir) {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Dir*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    # The hidden launcher's wscript host, if it is still around.
    Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -like "*run-agent.vbs*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Write-Step($message) { Write-Host "  $message" -ForegroundColor Gray }
function Write-Good($message) { Write-Host "  $message" -ForegroundColor Green }
function Write-Bad($message) { Write-Host "  $message" -ForegroundColor Red }

Write-Host ''
Write-Host '  Fonology print agent' -ForegroundColor Cyan
Write-Host '  ====================' -ForegroundColor Cyan
Write-Host ''

# ---------------------------------------------------------------------------
# 1. Node
# ---------------------------------------------------------------------------
# The agent is a Node program. Rather than assume, look for node.exe in three
# places and say exactly what to do if it is missing — "install Node" with no
# link is the kind of instruction that ends in a phone call.
if (-not $NodeExe) {
    $bundled = Join-Path $SourceDir 'node.exe'
    if (Test-Path $bundled) {
        $NodeExe = $bundled
        Write-Step "Using the copy of Node bundled with this installer."
    } else {
        $found = Get-Command node.exe -ErrorAction SilentlyContinue
        if ($found) { $NodeExe = $found.Source }
    }
}

if (-not $NodeExe -or -not (Test-Path $NodeExe)) {
    Write-Bad 'Node.js is not installed on this PC, and no copy was bundled with this installer.'
    Write-Host ''
    Write-Host '  Fix it one of two ways:' -ForegroundColor Yellow
    Write-Host '    1. Install Node.js 20 or newer from https://nodejs.org (choose the LTS'
    Write-Host '       Windows Installer), then run this installer again; or'
    Write-Host '    2. Copy node.exe into the folder above this one and run this again.'
    Write-Host ''
    exit 1
}

$nodeVersion = (& $NodeExe --version) 2>$null
Write-Good "Node found: $nodeVersion ($NodeExe)"

# ---------------------------------------------------------------------------
# 2. What we are installing
# ---------------------------------------------------------------------------
# dist/ is the WHOLE program: one bundled index.js plus the PowerShell host
# script. There is deliberately no node_modules to copy — see scripts/bundle.mjs
# for why shipping pnpm's symlinked tree does not survive being copied.
$distDir = Join-Path $SourceDir 'dist'

if (-not (Test-Path (Join-Path $distDir 'index.js'))) {
    Write-Bad "This installer is incomplete: no built agent in 'dist'."
    Write-Host "  Build it first with: pnpm --filter @fonology/print-agent build" -ForegroundColor Yellow
    exit 1
}

# ---------------------------------------------------------------------------
# 3. The two questions
# ---------------------------------------------------------------------------
if (-not $ApiUrl) {
    Write-Host ''
    $entered = Read-Host "  Fonology API address [$DefaultApiUrl]"
    $ApiUrl = if ([string]::IsNullOrWhiteSpace($entered)) { $DefaultApiUrl } else { $entered.Trim() }
}

if (-not $Token) {
    Write-Host ''
    Write-Host '  Paste the agent token from Settings -> Print agents.' -ForegroundColor Yellow
    Write-Host '  (It is shown once, when the token is created. If you have lost it,' -ForegroundColor Gray
    Write-Host '   create a new agent there and use the new token.)' -ForegroundColor Gray
    $Token = (Read-Host '  Token').Trim()
}

if ([string]::IsNullOrWhiteSpace($Token)) {
    Write-Bad 'No token was entered, so the agent would not be able to log in. Nothing was installed.'
    exit 1
}

# ---------------------------------------------------------------------------
# 4. Stop anything already running, then copy
# ---------------------------------------------------------------------------
# Reinstalling over a running agent would leave the old one holding the lock
# and the new files unused — the install would "succeed" and change nothing.
Write-Host ''
$existing = Invoke-Native schtasks.exe @('/Query', '/TN', $TaskName)
if ($existing.ExitCode -eq 0) {
    Write-Step 'Stopping the currently installed agent...'
    Invoke-Native schtasks.exe @('/End', '/TN', $TaskName) | Out-Null
    Start-Sleep -Seconds 2
}
Stop-AgentProcesses $InstallDir

Write-Step "Installing to $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# /MIR so an upgrade removes files that no longer exist rather than leaving a
# stale module behind for Node to resolve.
Invoke-Native robocopy @($distDir, (Join-Path $InstallDir 'dist'), '/MIR', '/NJH', '/NJS', '/NDL', '/NP', '/NFL') | Out-Null
if ($NodeExe -eq (Join-Path $SourceDir 'node.exe')) {
    Copy-Item $NodeExe $InstallDir -Force
    $NodeExe = Join-Path $InstallDir 'node.exe'
}
Write-Good 'Files copied.'

# ---------------------------------------------------------------------------
# 5. Configuration
# ---------------------------------------------------------------------------
# The token lands in a file readable only by this user. It is a deliberately
# feeble credential — it reaches the print endpoints and nothing else — but
# there is no reason to leave it world-readable on a shared PC.
$configPath = Join-Path $StateDir 'agent.json'
$config = [ordered]@{ apiBaseUrl = $ApiUrl; token = $Token; logLevel = 'info' }
# NOT Set-Content -Encoding utf8. In Windows PowerShell 5.1 that writes a UTF-8
# BOM, and JSON.parse rejects a leading BOM outright — the agent came up and
# reported "agent.json is not valid JSON" with a file that looked perfectly
# fine in every editor. WriteAllText with UTF8Encoding($false) writes no BOM.
# (The agent also strips a BOM defensively now, because the next person to edit
# this file will do it in Notepad.)
[System.IO.File]::WriteAllText(
    $configPath,
    ($config | ConvertTo-Json),
    (New-Object System.Text.UTF8Encoding($false)))

try {
    $acl = Get-Acl $configPath
    $acl.SetAccessRuleProtection($true, $false)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "$env:USERDOMAIN\$env:USERNAME", 'FullControl', 'Allow')
    $acl.SetAccessRule($rule)
    Set-Acl -Path $configPath -AclObject $acl
} catch {
    # Not fatal. A readable token is a smaller problem than a failed install,
    # and it is scoped to the print endpoints either way.
    Write-Step 'Note: could not restrict permissions on the config file.'
}
Write-Good "Configuration written to $configPath"

# ---------------------------------------------------------------------------
# 6. The hidden launcher
# ---------------------------------------------------------------------------
# A Scheduled Task running a console program shows a console window. On a till
# PC that window is both ugly and dangerous: it is one stray click away from
# being closed, which stops all printing with no warning.
#
# Launching through wscript.exe with window style 0 is the boring, decades-old
# way to start a console program with no window at all. It also means the task
# action finishes immediately, which is what lets the 10-minute repeat trigger
# act as a watchdog.
$launcher = Join-Path $InstallDir 'run-agent.vbs'
$entry = Join-Path $InstallDir 'dist\index.js'
# ASCII only in this file, and therefore no em dashes in the comments: it is
# written as ASCII so wscript never has to guess an encoding, and a non-ASCII
# character would come out as "???".
@"
' Starts the Fonology print agent with no console window.
' Generated by install.ps1 - edit the installer, not this file.
Set shell = CreateObject("WScript.Shell")
shell.Run """$NodeExe"" ""$entry""", 0, False
"@ | Set-Content -Path $launcher -Encoding ascii
Write-Good 'Launcher created.'

# ---------------------------------------------------------------------------
# 7. The scheduled task
# ---------------------------------------------------------------------------
# Registered from XML rather than with schtasks' command-line switches, because
# the settings that matter here — repeat forever, run on battery, never time
# out — are not all expressible as switches.
$userId = "$env:USERDOMAIN\$env:USERNAME"
$taskXml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Runs the Fonology print agent, which drives the receipt and label printers.</Description>
    <URI>\$TaskName</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$userId</UserId>
      <Repetition>
        <Interval>PT10M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$userId</UserId>
      <!-- InteractiveToken is load-bearing: it runs the agent inside the
           logged-on user's session, where the printers are. A task set to run
           "whether the user is logged on or not" lands in an isolated session
           and reintroduces exactly the Session 0 problem a service would
           have had. -->
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <!-- A till PC may be a laptop. Neither of these may stop printing. -->
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <!-- PT0S means no time limit. The agent is meant to run all day. -->
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>"$launcher"</Arguments>
      <WorkingDirectory>$InstallDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# schtasks requires the XML file to be UTF-16, and fails with an unhelpful
# parse error if it is not.
$xmlPath = Join-Path $env:TEMP 'fonology-print-agent-task.xml'
[System.IO.File]::WriteAllText($xmlPath, $taskXml, [System.Text.Encoding]::Unicode)

$create = Invoke-Native schtasks.exe @('/Create', '/TN', $TaskName, '/XML', $xmlPath, '/F')
Remove-Item $xmlPath -Force -ErrorAction SilentlyContinue

if ($create.ExitCode -ne 0) {
    Write-Bad "Could not register the scheduled task (schtasks exit code $($create.ExitCode))."
    Write-Host "  $($create.Output.Trim())" -ForegroundColor Yellow
    Write-Host '  The agent is installed but will not start by itself.' -ForegroundColor Yellow
    exit 1
}
Write-Good "Scheduled task '$TaskName' registered (starts at logon, checks every 10 minutes)."

# ---------------------------------------------------------------------------
# 8. Start it now
# ---------------------------------------------------------------------------
Invoke-Native schtasks.exe @('/Run', '/TN', $TaskName) | Out-Null

# Poll rather than sleep-and-hope. Startup includes fetching printer settings
# over the internet and compiling the print host's interop, which took eleven
# seconds on a cold run here — a fixed six-second wait reported a perfectly
# healthy install as broken.
$logFile = Join-Path $StateDir 'logs\agent.log'
Write-Host ''
Write-Step 'Waiting for the agent to come up...'

$deadline = (Get-Date).AddSeconds(45)
$started = $false
while ((Get-Date) -lt $deadline) {
    if (Test-Path $logFile) {
        $recent = Get-Content $logFile -Tail 25 -Encoding UTF8 -ErrorAction SilentlyContinue
        if ($recent -match 'worker started') { $started = $true; break }
        # Configuration problems are terminal — no amount of waiting fixes a
        # bad token, and saying so beats a 45-second pause and a timeout.
        if ($recent -match 'not configured|is not valid JSON|token was rejected') { break }
    }
    Start-Sleep -Seconds 2
}

Write-Host ''
if ($started) {
    Write-Good 'The agent is running.'
} elseif (Test-Path $logFile) {
    Write-Bad 'The agent started but did not begin printing. Its log is below.'
} else {
    Write-Bad 'The agent did not write a log at all. Something is wrong.'
    Write-Host "  Check $StateDir" -ForegroundColor Yellow
}

if (Test-Path $logFile) {
    Write-Host ''
    Write-Host '  Recent log:' -ForegroundColor Gray
    Get-Content $logFile -Tail 12 -Encoding UTF8 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

Write-Host ''
Write-Host '  Done.' -ForegroundColor Cyan
Write-Host "  Logs:     $logFile"
Write-Host "  Settings: $configPath"
Write-Host '  To remove it, run uninstall.cmd in this folder.'
Write-Host ''
