@echo off
chcp 65001 >nul
cd /d "%~dp0"
title LookAtThis - instalacka
if not exist "node_modules\.lookatthis-deps-2" (
  call npm install --no-audit --no-fund || (pause & exit /b)
  echo ok> "node_modules\.lookatthis-deps-2"
)
call npm run build
echo.
echo  Hotovo. Instalacku najdes v priecinku dist.
pause
