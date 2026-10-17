@echo off
chcp 65001 >nul
cd /d "%~dp0"
title LookAtThis
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Na spustenie treba Node.js ^(staci raz^).
  echo  Otvaram nodejs.org, stiahni verziu LTS, nainstaluj ju a spusti tento subor znova.
  start https://nodejs.org
  pause
  exit /b
)
if not exist "node_modules\.lookatthis-deps-2" (
  echo.
  echo  Instalujem LookAtThis, potrva to minutku...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo  Instalacia zlyhala. Skontroluj internet a skus znova.
    pause
    exit /b
  )
  echo ok> "node_modules\.lookatthis-deps-2"
)
start "" "node_modules\electron\dist\electron.exe" .
