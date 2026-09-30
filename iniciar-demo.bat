@echo off
chcp 65001 >nul
title Painel de Obras Unita - Demonstracao
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :sem_node

if exist node_modules goto :iniciar
echo.
echo Instalando dependencias - apenas na primeira vez, pode levar alguns minutos...
call npm install
if errorlevel 1 goto :erro

:iniciar
echo.
echo Preparando e iniciando o Painel de Obras...
call npm run demo
if errorlevel 1 goto :erro
goto :fim

:sem_node
echo.
echo Node.js nao foi encontrado neste computador.
echo Instale a versao LTS em https://nodejs.org e depois execute este arquivo novamente.
start "" https://nodejs.org/pt-br/download
pause
exit /b 1

:erro
echo.
echo Ocorreu um erro. Tire um print desta janela e envie para o suporte.
pause
exit /b 1

:fim
