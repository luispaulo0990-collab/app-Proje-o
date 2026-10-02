@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Publicar alteracoes no GitHub

where git >nul 2>nul
if errorlevel 1 (
  echo Git nao encontrado neste computador. Instale em https://git-scm.com e tente de novo.
  pause
  exit /b 1
)

rem Arquivo substituido por incc-indices.repository.ts (02/10/2026)
if exist "apps\api\src\database\repositories\incc-rates.repository.ts" git rm -q -f "apps\api\src\database\repositories\incc-rates.repository.ts"

git add -A
echo.
echo Arquivos que serao enviados ao GitHub:
echo -------------------------------------
git status --short
echo -------------------------------------
echo.
echo Confira a lista acima. O arquivo integracao-microsoft.txt NAO deve aparecer.
choice /c SN /m "Enviar para o GitHub agora"
if errorlevel 2 (
  git reset -q
  echo Cancelado. Nada foi enviado.
  pause
  exit /b 0
)

git commit -q -m "feat: taxa emitida + INCC por numero-indice, coluna IEC Obra no Consolidado" -m "- Taxa emitida mensal por obra e correcao do saldo pelo INCC (competencia M-1)" -m "- INCC cadastrado como numero-indice; o motor deriva a variacao. Historico INCC-DI (FGV) AGO/1994-AGO/2026 (migration 0005_incc_indices)" -m "- Coluna IEC obra / resultado no Consolidado (aba BD_Economico; migration 0004_economic_indicators)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01SUJXDwVZxpp9SDQWQzwJr4"
if errorlevel 1 (
  echo Nenhuma alteracao nova para enviar, ou falha no commit.
)
git push origin main
if errorlevel 1 (
  echo.
  echo O envio falhou. Tire um print desta janela e envie no chat.
  pause
  exit /b 1
)
echo.
echo Alteracoes publicadas no GitHub.
pause
