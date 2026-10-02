@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Feche a demonstracao antes de continuar.
echo.
if "%~1"=="" (
  node scripts\usuarios.mjs
) else (
  node scripts\usuarios.mjs %*
)
echo.
pause
