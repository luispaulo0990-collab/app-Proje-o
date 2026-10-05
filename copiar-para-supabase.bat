@echo off
chcp 65001 >nul
title Painel de Obras Unita - Copiar dados para o Supabase
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :sem_node

if not exist .env goto :sem_env
findstr /b /c:"DATABASE_URL=postgres" .env >nul
if errorlevel 1 goto :sem_env

if not exist .demo-data\db goto :sem_demo

if exist node_modules goto :copiar
echo.
echo Instalando dependencias - apenas na primeira vez...
call npm install
if errorlevel 1 goto :erro

:copiar
echo.
echo Copiando os dados da demonstracao (.demo-data) para o Supabase...
echo Feche a janela da demonstracao antes de continuar.
pause
call npm run db:copy -- %*
if errorlevel 1 goto :erro
echo.
echo Pronto. Os dados agora estao no Supabase.
pause
exit /b 0

:sem_node
echo.
echo Node.js nao foi encontrado. Instale a versao LTS em https://nodejs.org
pause
exit /b 1

:sem_env
echo.
echo Crie o arquivo .env na raiz do projeto com DATABASE_URL e DATABASE_MIGRATION_URL do Supabase.
echo Passo a passo em docs\SUPABASE.md
pause
exit /b 1

:sem_demo
echo.
echo Nao encontrei o banco da demonstracao em .demo-data\db
pause
exit /b 1

:erro
echo.
echo A copia nao foi concluida (nada foi gravado pela metade). Tire um print desta janela.
pause
exit /b 1
