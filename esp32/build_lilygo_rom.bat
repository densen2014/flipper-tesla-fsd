@echo off
setlocal

cd /d "%~dp0"

echo [build] PlatformIO env: esp32-lilygo
pio run -e esp32-lilygo
if errorlevel 1 (
  echo.
  echo [build] FAILED
  exit /b 1
)

echo.
echo [build] SUCCESS
echo [build] OTA image:
echo   %CD%\.pio\build\esp32-lilygo\firmware.bin
echo [build] Full ROM image (flash at 0x0):
echo   %CD%\.pio\build\esp32-lilygo\firmware-merged.bin

exit /b 0
