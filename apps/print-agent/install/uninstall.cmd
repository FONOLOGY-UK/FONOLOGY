@echo off
rem Removes the Fonology print agent. See uninstall.ps1 for what it touches.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
