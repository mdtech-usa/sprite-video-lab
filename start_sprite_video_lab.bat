@echo off
setlocal
cd /d "%~dp0"

if "%SPRITE_VIDEO_LAB_HOST%"=="" set "SPRITE_VIDEO_LAB_HOST=127.0.0.1"
if "%SPRITE_VIDEO_LAB_PORT%"=="" set "SPRITE_VIDEO_LAB_PORT=8894"

set "PYTHON_EXE="
for /f "delims=" %%i in ('where python 2^>nul') do (
  set "PYTHON_EXE=%%i"
  goto :python_ready
)
for /f "delims=" %%i in ('where py 2^>nul') do (
  set "PYTHON_EXE=%%i"
  goto :python_ready
)

echo Python not found.
exit /b 1

:python_ready
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$serverPath = [System.IO.Path]::GetFullPath('%~dp0server.py');" ^
  "$escaped = [Regex]::Escape($serverPath);" ^
  "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match $escaped } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"

start "Sprite Video Lab Server" "%PYTHON_EXE%" "%~dp0server.py" --host "%SPRITE_VIDEO_LAB_HOST%" --port "%SPRITE_VIDEO_LAB_PORT%"
timeout /t 2 >nul
start "" http://%SPRITE_VIDEO_LAB_HOST%:%SPRITE_VIDEO_LAB_PORT%
