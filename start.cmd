@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "runtime\node.exe" (
  "runtime\node.exe" server.mjs --open
) else (
  node server.mjs --open
)
pause
