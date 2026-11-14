@echo off
rem Mark - Windows installer. Double-click this file (no administrator needed).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1"
echo.
pause
