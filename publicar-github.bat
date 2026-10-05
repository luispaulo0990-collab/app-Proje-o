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
echo Confira a lista acima. NAO devem aparecer: .env, supabase.env.txt, integracao-microsoft.txt.
choice /c SN /m "Enviar para o GitHub agora"
if errorlevel 2 (
  git reset -q
  echo Cancelado. Nada foi enviado.
  pause
  exit /b 0
)

git commit -q -m "chore: banco no Supabase e limpeza do repositorio" -m "- Conexao PostgreSQL do Supabase (pooler de transacao/sessao, TLS) e Data API fechada (RLS)" -m "- Copia conferida do banco da demonstracao para o Supabase (npm run db:copy)" -m "- Remove arquivos locais sem uso (copia antiga unita-projecoes, prints, apresentacao)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Vkwy7rC7djLfFfiZzRoPsj"
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
