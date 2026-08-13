@echo off
rem ===========================================================================
rem  Fonology print agent — installer.
rem
rem  This is the file a member of staff double-clicks. It exists only to launch
rem  install.ps1 with an execution policy that will actually run it; all of the
rem  real work is in the PowerShell script next to this one, where it can be
rem  read and reviewed.
rem
rem  Deliberately does NOT request administrator rights. Everything the agent
rem  needs — its program folder, its data folder, and its scheduled task — sits
rem  in places a standard user may write to. Asking for admin would put a UAC
rem  prompt in front of the one person we are trying to keep this simple for,
rem  and would buy nothing.
rem ===========================================================================

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

rem Keep the window open so any message the script printed is readable. Without
rem this the window closes instantly on both success and failure, and a failed
rem install looks exactly like a successful one.
echo.
pause
