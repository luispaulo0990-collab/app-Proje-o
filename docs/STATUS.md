# Status do projeto — Painel de Obras Unità

Atualizado em 07/10/2026.

## Onde está o código

Pasta local do usuário: `Desktop/Projeto APP-PROJEÇÃO` (raiz do repositório GitHub `app-Proje-o`, monorepo npm workspaces). A subpasta `unita-projecoes` é uma cópia antiga.

## Decisões confirmadas com o usuário

- Hospedagem: **Hostinger VPS** → Node 22 + PostgreSQL 16 + Nginx + PM2, um domínio com `/api`.
- Taxa: `taxa mensal = %físico × orçamento raso × %taxa`, recebida no **mês seguinte ao avanço (competência M−1, fixa)**. Desde 01/10/2026: **taxa emitida** mensal por obra + **INCC** mensal (o de M−1 corrige o saldo de M); o saldo é projetado pela curva. Substituiu a defasagem por obra e o “Ajuste projeção taxa”.
- Escopo da 1ª sessão: plano + Fases 1–5.
- Curvas próprias das obras: **endpoint genérico** (`PUT /works/:id/actual-curve`, JWT ou `X-Api-Key`); sistema de origem ainda a definir.
- Curva própria de obra iniciada **recalcula a taxa** (receita) e alimenta o Consolidado.

## Concluído (Fases 1–5)

- Motor `packages/engine` (53 testes): cronograma, validação/canonização/normalização de curvas, reamostragem, maior resto, taxa com defasagem, ajustes manuais (PRESERVE/REPLACE), hydrate, KPIs, carteira.
- API Fastify `/api/v1` (23 testes de integração com Postgres real): auth completa (Argon2id, JWT + refresh rotativo com detecção de reuso, reset de senha), RBAC ADMIN/EDITOR/VIEWER, obras (CRUD, duplicar, arquivar, exclusão protegida), curvas versionadas imutáveis, projeções versionadas, auditoria, OpenAPI em /api/docs.
- Web React: login/cadastro/recuperação, obras (lista + formulário com término calculado), curvas (lista, detalhe com gráfico, editor com colar do Excel e normalizar), obra com sidebar (Projeção com KPIs e prévia read-only da grade, Informações, Curva, Histórico, Configurações), fluxo de recálculo com diálogo de ajustes manuais.
- Docs: ARCHITECTURE.md, CALCULATION_RULES.md, DEPLOY_HOSTINGER.md, README.md.

## Concluído (29/09/2026 — Consolidado e Curvas das obras)

- Menu principal ganhou **Consolidado** (`/consolidado`) e **Curvas das obras** (`/curvas-obras`).
- Consolidado = aba “Painel (2)”: cabeçalho fixo com taxa do mês, acumulado no ano e qtd. de obras ativas; KPIs (taxa projetada, recebida, a receber, taxa do mês, acumulado do ano, obras ativas) e “Acumulado AAAA”; cada obra em 2 linhas (avanço físico / taxa), mês de referência destacado.
- Curvas das obras: regra no engine (`resolveEffectiveCurve`) — não iniciada → paramétrica; iniciada com curva própria → própria (início e duração próprios); iniciada sem curva → paramétrica + aviso “Aguardando API”. Botão “Sincronizar projeções” (`POST /work-curves/sync`).
- Aba Curva da obra: sub-aba “Curva própria (API)” com gráfico, versões, lançamento manual (colar do Excel) e exemplo de integração.
- Banco: migration `0001_work_actual_curves` (tabelas `work_actual_curves`, `work_actual_curve_points`; `projections.curve_source` e `work_actual_curve_id`).
- Testes: engine 64 · API 35 · web 3.

## Concluído (29/09/2026 — Integração SharePoint / Microsoft Graph)

- Fonte das curvas próprias: `Consolidado Físico - Obras.xlsx`, aba **BD_Infos Gerais**, coluna **Replanejado Atual Acumulado - Obra** (decisão do usuário: “a realidade é o replanejado atual”). `BD_Físico por atividade` e `BD_Orc` **não** são usadas (orçamento ainda não validado).
- Casamento pelo nome padrão da obra cadastrado; relatório mostra obras sem cadastro e obras ausentes da planilha.
- `POST /integrations/work-curves/sync` (Simular / Importar na aba Curvas das obras), CLI para cron, credenciais `MS_GRAPH_*` só no servidor.
- **Pendente do usuário:** App Registration no Entra com `Sites.Read.All` (aplicativo) + consentimento; preencher `MS_GRAPH_TENANT_ID/CLIENT_ID/CLIENT_SECRET`. Validar o layout real da aba BD_Infos Gerais na 1ª simulação (o conector de leitura só mostrou a aba por atividade).
- Testes: engine 69 · API 45 · web 3.

## Concluído (29/09/2026 — Carteira real no modo demonstração)

- As obras fictícias da demonstração (Vila das Belezas, Mooca, Tucuruvi, Vila Matilde com datas e curva do Tucuruvi inventadas) são removidas automaticamente (exclusão lógica; obras criadas por usuários não são tocadas).
- Importadas as **37 obras da aba Painel (2)** de `Painel de obras.xlsx` (`apps/api/src/database/data/painel-obras.json`): cliente, obra, UH, orçamento raso, % taxa (8 casas), defasagem da taxa (1º mês de taxa − 1º mês de avanço), início e avanço físico mensal → curva própria `PLANILHA PAINEL (2)`. Curva paramétrica de referência: Curva Padrão 22 meses. Sistema construtivo “Não informado” (coluna vazia na planilha).
- Não importadas: Bumerangue (Teen — sem avanço físico) e Parque das Cerejeiras (Direcional — sem orçamento).
- Ajustes: valores-sentinela (1e-11, 1e-7, 1e-13) viram 0%; Cupece (103,04%) e Alvorada (101,50%) normalizadas para 100%; Dom Bosco, Centro e Casa Genebra começam antes de JAN/23 (início da coluna Início).
- Conferência: taxa total R$ 97.125.729,82 × Σ Taxa ADM Prevista R$ 97.125.729,51 (R$ 0,31 de arredondamento da % taxa); Qtd. obras ativas bate com a planilha (ex.: JAN–MAI/25 = 24, 24, 21, 25, 27).
- Grades do Consolidado e Curvas das obras abrem no mês atual. Sincronização SharePoint desempata obras de mesmo nome (Tucuruvi — Limac / Marka Prime) pelo cliente.
- Testes: engine 69 · API 47 · web 3.

## Concluído (30/09/2026 — Colunas do Consolidado)

- Consolidado virou **uma grade única** (pedido do usuário: “mesclar o consolidado antigo com o novo”): colunas congeladas Cliente · Obra · Série, depois as colunas do painel — Orçamento raso, UH (cadastro) · Início / meses incorridos (1º mês da curva própria da API) · Término projetado / duração (curva a 100%) · Avanço ac./mês (**Realizado Acumulado** da API) · Status cliente · Taxa prevista · Recebida · Taxa mês · A receber · **Ajuste projeção taxa** (editável) — e em seguida os **meses** com avanço físico e taxa de cada obra (2 linhas por obra). Cabeçalho fixo com taxa no mês, acumulado no ano e obras ativas; totais do painel na linha “Taxa no mês”. Botões “Ocultar/Mostrar colunas do painel” (`?painel=0`), “Ir para o painel” e “Ir para MÊS/AA”. KPI “Obras atrasadas (cliente)”.
- O arquivo `apps/web/src/features/portfolio/ConsolidatedPanelTable.tsx` deixou de ser usado (pode ser apagado).
- Status cliente: **Atrasada** se `Replanejado Atual Acumulado - Cliente` < `Meta Acumulada - Atual` no último mês ≤ referência; mostra o desvio em p.p.
- Ajuste projeção taxa (decisão do usuário: “recalibrar dali em diante”): novo total a receber após a referência, distribuído pela curva nos meses seguintes; nova versão da projeção; reaplicado em todo recálculo; histórico + remoção. Taxa mês = taxa projetada do mês (não há fonte de faturamento real ainda).
- API: `GET/PUT /works/:id/progress-indicators` (JWT ou `X-Api-Key`), `PUT/DELETE /works/:id/fee-recalibration`; sincronização SharePoint passa a ler também as colunas Realizado Acumulado, Replanejado Atual Acumulado - Cliente e Meta Acumulada - Atual (`MS_GRAPH_REALIZED_COLUMN`, `MS_GRAPH_CLIENT_REPLANNED_COLUMN`, `MS_GRAPH_TARGET_COLUMN`).
- Banco: migration `0002_consolidated_indicators` (`work_progress_indicators`, `fee_recalibrations`).
- Docs: CALCULATION_RULES §13–15, ARCHITECTURE (tabelas e endpoints).
- Testes: engine 82 · API 58 · web 3.
- **Pendente:** no modo demonstração não há Graph configurado, então Avanço/Status aparecem como “Aguardando API / Sem dados” até a 1ª sincronização (ou envio pelo endpoint). Confirmar na 1ª simulação que a coluna “Meta Acumulada - Atual” existe com esse nome na aba BD_Infos Gerais.

## Concluído (02/10/2026 — Coluna IEC Obra no Consolidado)

- Integração Microsoft Graph validada pelo usuário (“a API está funcionando”).
- Nova coluna **IEC obra / resultado** no Consolidado (após Status cliente): IEC do último fechamento ≤ mês de referência e, embaixo, o Resultado Projetado Obra (vermelho se negativo).
- Fonte: aba **BD_Econômico** (`.../workbook/worksheets('BD_Econômico')/usedRange`), linha **Item = “Geral”**, colunas `IEC Obra` e `Resultado Projetado Obra`; lida na mesma execução de Simular / Importar (botão agora “Importar curvas e IEC”), com relatório próprio no painel de sincronização. Variáveis `MS_GRAPH_SHEET_ECONOMICO`, `MS_GRAPH_IEC_COLUMN`, `MS_GRAPH_PROJECTED_RESULT_COLUMN`, `MS_GRAPH_ECONOMICO_TOTAL_ITEM` (padrões já corretos).
- Motor: `computeEconomicIndicators`, `canonicalEconomicEntry`, `isEconomicClosing` (IEC 0 = sem IEC; IEC 0 + resultado 0 = sem fechamento). API: `GET/PUT /works/:id/economic-indicators` (JWT EDITOR ou `X-Api-Key`), auditoria `IMPORT_ECONOMIC`. Banco: migration `0004_economic_indicators` (`work_economic_indicators`). Regras: CALCULATION_RULES §16.
- Testes: engine 101 · API 71 · web 4.
- **Pendente:** confirmar na 1ª simulação que a linha “Geral” traz o IEC preenchido (na amostra de MAI/26 do Klabin a linha Geral e os itens vieram com IEC 0). Se o IEC só existir por item, definir a regra de consolidação.

## Concluído (02/10/2026 — INCC por número-índice + histórico INCC-DI)

- Decisão do usuário: o cadastro do INCC passa a ser o **índice do mês**, não mais a variação. O motor calcula a variação (`índice M ÷ índice M−1 − 1`, 8 casas) com `inccRatesFromIndices`; a regra de correção (INCC de M−1 corrige o saldo de M) não mudou.
- Histórico **INCC-DI (FGV), AGO/1994 → AGO/2026, 385 meses** (`INCC-DI.xlsx`, aba Plan1) em `apps/api/src/database/data/incc-di.json`, carregado pelo seed só nos meses ainda não cadastrados (edições nunca são sobrescritas); após a carga as obras com taxa emitida são recalculadas. Conferência: variações recalculadas batem com a coluna “No mês” da planilha (diferença máx. 0,005 p.p., arredondamento da FGV). Data 02/07/2011 normalizada para 01/07/2011.
- Banco: migration `0005_incc_indices` (cria `incc_indices`, **remove `incc_rates`** — variações digitadas antes não são convertidas; o histórico as substitui).
- API: `GET/PUT/DELETE /incc-indices[/:mes]` (`{ index }`) e `PUT /incc-indices` em lote; o DTO traz `index` e a `rate` calculada. Auditoria `INCC_SET`, `INCC_IMPORT`, `INCC_REMOVED`.
- Web: painel “INCC mensal (número-índice)” — campo “INCC do mês (índice)”, lista com índice e variação calculada, mensagem com a variação após salvar.
- Testes: engine 103 · API 73 · web 4.

## Concluído (05/10/2026 — Dados no Supabase)

- Pedido do usuário: salvar as informações no servidor Supabase; aplicação na **Vercel**; **copiar** os dados já lançados na demonstração.
- Conexão: `DATABASE_URL` = transaction pooler (6543, Vercel), `DATABASE_MIGRATION_URL` = session pooler (5432, migrations/seed/cópia). TLS em `database/ssl.ts`: `DATABASE_SSL=auto|disable|require|verify-full` + `DATABASE_SSL_CA` (PEM, base64 ou arquivo); `sslmode` da URL é tratado e removido para não conflitar com o `pg`.
- Segurança: `hardenForSupabase` roda após toda migration — RLS sem políticas em todas as tabelas de `public` e revogação de `anon`/`authenticated` (inclusive privilégios padrão). Sem efeito em Postgres comum/PGlite.
- Cópia: `npm run db:copy` / `copiar-para-supabase.bat` — origem `.demo-data/db`, destino `DATABASE_MIGRATION_URL`; ordem por FKs, transação única, sequências ajustadas, conferência SHA-256 por tabela; recusa sobrescrever destino com usuários sem `--substituir`.
- Guia: `docs/SUPABASE.md`. Testes: API 81 (8 novos; suíte inteira rodando com RLS ligado).
- **Pendente do usuário:** preencher `.env` com as conexões do Supabase, rodar a cópia e configurar as variáveis na Vercel.

## Concluído (05/10/2026 — Usuários pelo Supabase Authentication)

- Pedido do usuário: criar usuários em Supabase → Authentication (não pela tela inicial) e definir o nível na tabela `users`.
- `AUTH_PROVIDER=supabase` (+ `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`): login, “esqueci a senha” e redefinição passam pelo Supabase Auth (REST, só a chave publishable, sem SDK); a API mantém a própria sessão (JWT 15 min + refresh em cookie) e os papéis. `/auth/register` responde 403; `GET /auth/config` informa o modo e a tela de login esconde “Criar conta”.
- Banco: migration `0006_supabase_auth` (`users.password_hash` opcional, `users.auth_user_id` único). `syncSupabaseAuthUsers` (após cada migration e após a cópia) instala gatilhos em `auth.users`: novo usuário → perfil VIEWER (ou vincula pelo e-mail); troca de e-mail acompanha; exclusão → `is_active=false`. Sem permissão para gatilhos, vincula/cria no 1º login.
- Web: `/redefinir-senha` aceita o link do Supabase (`#access_token…&type=recovery|invite`); convite vira “Defina sua senha”.
- Testes: API 90 · web 7. Guia: `docs/SUPABASE.md` §4.
- **Pendente do usuário:** variáveis na Vercel; URL Configuration (Site URL + Redirect `/redefinir-senha`) no Supabase; criar os usuários em Authentication com os mesmos e-mails da demonstração.

## Concluído (05/10/2026 — Deploy Vercel e Graph em produção)

- Deploy na Vercel (`painel-obras-unita`, região `gru1`). Correção: `content-disposition` fixado em 1.x (`overrides`) e `@fastify/static` carregado só no modo demonstração — o runtime da Vercel não faz `require()` de ESM (`ERR_REQUIRE_ESM`).
- Banco da demonstração recuperado (WAL corrompido → `pg_resetwal` numa cópia) e exportado em `.demo-data/recuperado.tar.gz`; `db:copy` usa esse arquivo quando existe (`pglite:dump=`).
- Microsoft Graph na Vercel: variáveis `MS_GRAPH_*` + `CRON_SECRET`; importação diária automática (Vercel Cron 09:00 UTC → `GET /integrations/work-curves/cron`); `maxDuration` 300 s. Testes: API 92.

## Concluído (07/10/2026 — Vigências da taxa e periodicidade do INCC)

- Pedido do usuário: mudar a taxa “a partir de agora” informando a **taxa nova** (não a variação) e tornar mutável a correção pelo INCC, com periodicidade **mensal, trimestral, quadrimestral, semestral ou anual** (a variação do INCC no período corrige o recebimento).
- Motor 0.4.0: `fee-terms.ts` (taxa vigente por mês), `createInccCorrector` (janelas a partir da data-base, sem dupla contagem na troca de periodicidade), variação calculada direto do número-índice. Regras: CALCULATION_RULES §17.
- Banco: migration `0008_work_fee_terms`. API: `/works/:id/fee-terms`. Web: aba **Taxa e INCC** na obra; cadastro da obra com “Correção pelo INCC” e “Mês-base do INCC”.
- Limpeza: removidos `publicar-github.bat` (gerava commits repetidos com a mesma mensagem), `apps/api/vercel.json` (duplicado), dependências e exports sem uso.
- Testes: engine 114 · API 100 · web 7.
- **A decidir com o usuário:** se a correção deve começar antes da 1ª taxa emitida (hoje, como na §15, o INCC só corrige o saldo depois da 1ª emissão); se a duplicação de obra deve copiar as vigências.

## Concluído (07/10/2026 — Curva realizada + tendência)

- Pedido do usuário: até o mês atual a curva da obra vem do **Realizado Acumulado** (mês atual só se tiver avanço); depois, **curva de tendência** combinando o realizado e o **Replanejado Atual Acumulado - Obra** (ex.: ritmo 3%, plano pede 15% → ~10%).
- Regra: tendência = 0,6 × replanejado + 0,4 × ritmo médio dos últimos 3 meses, distribuída proporcionalmente até o **término do replanejado** (o prazo planejado é mantido). CALCULATION_RULES §18.
- Recálculo automático quando chega realizado novo ou o mês vira (impressão digital da curva na projeção); “Curvas das obras” marca os meses de tendência.
- Testes: engine 123 · API 102 · web 7.
- **A validar com o usuário:** peso 0,6 do replanejado e janela de 3 meses (constantes `TREND_PLAN_WEIGHT`, `TREND_WINDOW_MONTHS`); se devem ser configuráveis por obra.

## Concluído (07/10/2026 — Projeção manual da taxa no Consolidado)

- Pedido do usuário: projetar a taxa manualmente no Consolidado, com tudo se recalculando em todas as abas, mantendo vários meses manuais (ex.: mês que vem e 3 meses à frente).
- Web: células da linha “Taxa (R$)” editáveis (`FeeProjectionCell`); edição inline reaproveitada da taxa emitida (`InlineMoneyInput`).
- API: `regenerateOrFlagStale` — recálculos automáticos preservam os ajustes manuais (antes marcavam a projeção como desatualizada); só marcam quando um ajuste não cabe mais. Células do Consolidado trazem `periodIndex`. CALCULATION_RULES §19.
- Testes: engine 125 · API 105 · web 7.
- **A decidir com o usuário:** se meses passados sem taxa emitida devem ficar fixos (hoje também absorvem a redistribuição).

## Próximos passos

1. **Fase 6** — grade editável estilo Excel (TanStack Table + virtualização): edição de célula, Enter/Tab/setas, copiar/colar, seleção múltipla, marcação manual, salvar em lote (PUT /projections/:workId já existe); visão de carteira já existe (Consolidado, somente leitura); falta virtualizar para centenas de obras.
2. Fase 7 — comparação entre versões de projeção; tela de administração de usuários (API pronta).
3. Configurar credenciais Graph, rodar a 1ª simulação e agendar o cron (`integrations:sync-curves:prod`). Depois: validar BD_Orc para trazer orçamento.
4. Pendências menores: tela de usuários, exportação CSV/Excel via Integration Layer, colunas gerenciais da planilha (IEC, INCC, áreas, equipe).

## Modo demonstração (adicionado)

- `iniciar-demo.bat` (duplo clique no Windows) ou `npm run demo`: só exige Node.js LTS.
- Usa PostgreSQL embarcado (PGlite, `DATABASE_URL=pglite:<pasta>`) em `.demo-data/`, aplica migrations, carrega curvas + as 37 obras reais da planilha e serve API + site em http://localhost:3333.
- Primeiro usuário cadastrado vira ADMIN. Não é para produção.

## Concluído (01/10/2026 — Taxa emitida e INCC no Consolidado)

- Decisões do usuário: correção composta mês a mês do saldo (`saldo × (1 + INCC)`); INCC de M−1 corrige M; competência M−1 fixa para todas as obras; a taxa emitida substitui o “Ajuste projeção taxa”.
- Motor: `fee-schedule.ts` (`buildFeeSchedule`, `FEE_COMPETENCE_LAG_MONTHS = 1`), `distribution.ts`; origem de célula `ISSUED`; `feeAdjustment` no resultado. Motor 0.3.0. 19 testes novos (93 no total).
- API: `GET/PUT/DELETE /works/:id/fee-issuances[/:mes]` e `GET/PUT/DELETE /incc-rates[/:mes]` (JWT EDITOR ou `X-Api-Key`); auditoria; recálculo das obras com emissão ao salvar INCC; grade da projeção bloqueia edição de mês emitido. Removidos `/fee-recalibration` e o campo `feeLagMonths`. 8 testes novos (64 no total).
- Banco: migration `0003_fee_issuances_incc` (`fee_issuances`, `incc_rates`, valor `ISSUED` em `cell_origin`; remove `fee_recalibrations` e `works.fee_lag_months`). Ao migrar, projeções antigas são recalculadas uma vez com as regras novas (`fee-rules-upgrade.ts`), preservando ajustes manuais.
- Web: coluna “Taxa emitida no mês” (edição inline, remoção com confirmação), painel “INCC mensal” no Consolidado, células verdes = taxa emitida; formulário da obra sem defasagem.
