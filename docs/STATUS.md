# Status do projeto — Painel de Obras Unità

Atualizado em 30/09/2026.

## Onde está o código

Pasta local do usuário: `Desktop/Projeto APP-PROJEÇÃO/unita-projecoes` (monorepo npm workspaces).

## Decisões confirmadas com o usuário

- Hospedagem: **Hostinger VPS** → Node 22 + PostgreSQL 16 + Nginx + PM2, um domínio com `/api`.
- Taxa: `taxa mensal = %físico × orçamento raso × %taxa`, com **defasagem configurável por obra** (`feeLagMonths`).
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

## Próximos passos

1. **Fase 6** — grade editável estilo Excel (TanStack Table + virtualização): edição de célula, Enter/Tab/setas, copiar/colar, seleção múltipla, marcação manual, salvar em lote (PUT /projections/:workId já existe); visão de carteira já existe (Consolidado, somente leitura); falta virtualizar para centenas de obras.
2. Fase 7 — comparação entre versões de projeção; tela de administração de usuários (API pronta).
3. Configurar credenciais Graph, rodar a 1ª simulação e agendar o cron (`integrations:sync-curves:prod`). Depois: validar BD_Orc para trazer orçamento.
4. Pendências menores: tela de usuários, exportação CSV/Excel via Integration Layer, colunas gerenciais da planilha (IEC, INCC, áreas, equipe).

## Modo demonstração (adicionado)

- `iniciar-demo.bat` (duplo clique no Windows) ou `npm run demo`: só exige Node.js LTS.
- Usa PostgreSQL embarcado (PGlite, `DATABASE_URL=pglite:<pasta>`) em `.demo-data/`, aplica migrations, carrega curvas + as 37 obras reais da planilha e serve API + site em http://localhost:3333.
- Primeiro usuário cadastrado vira ADMIN. Não é para produção.
