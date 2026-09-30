# Painel de Obras Unità — Arquitetura e Plano (Etapa 46)

> Documento vivo. Toda decisão arquitetural relevante gera um ADR em `docs/adr/`.

## 1. Análise dos insumos

### 1.1 Planilha "Painel de obras.xlsx"

| Aba                         | O que faz                                                                                                                                                              | Impacto no sistema                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Painel (2)** / **Painel** | Carteira de obras. Cada obra ocupa **duas linhas**: `Avanço Físico` (% mensal) e `Taxa (R$)` (receita mensal). Meses de JAN/23 em diante no eixo X (`EOMONTH(...)+1`). | Confirma o modelo: 1 obra → N séries temporais mensais. Grade horizontal com colunas congeladas.           |
|                             | `Taxa ADM Prevista = % taxa × Orçamento Raso`.                                                                                                                         | Receita da obra = orçamento × taxa.                                                                        |
|                             | `Taxa Recebida / A Receber` = soma até / depois do **mês de referência** (`MATCH(Referência, meses)`).                                                                 | KPIs de realizado × restante dependem de uma **data de referência**.                                       |
|                             | Linha de totais por mês (`SUM(IF(tipo="Taxa (R$)"...))`), `Qtd Obras` ativas por mês, `Acumulado no Ano` (reinicia em janeiro).                                        | Motor precisa de agregação da carteira: total mensal, acumulado anual, contagem de obras ativas.           |
|                             | Colunas gerenciais: diretor, gerente, coordenador, IEC, aditivos, INCC, áreas, status Atrasada/Adiantada.                                                              | Fora do escopo das fases 1–5; modelo de dados fica extensível (tabela `works` + futura `work_attributes`). |
| **Painel de Obras (2..4)**  | Painel informativo por competência (avanço acumulado, status).                                                                                                         | Futuro módulo de "realizado" e dashboards.                                                                 |

Observações importantes:

- Os `% Avanço Físico` são **frações** (0,0147 = 1,47%). Há valores-sentinela como `1e-11` e `1e-05`, usados para "marcar" meses — o sistema substitui isso por status explícito.
- Em várias obras a `Taxa (R$)` começa **1 a 3 meses depois** do avanço → decisão: **defasagem configurável por obra** (`feeLagMonths`).
- Há fórmulas quebradas (`#REF!`) na linha "Mês" — reforça a necessidade de uma fonte única de verdade.

### 1.2 Identidade visual

| Token                     | Valor     | Origem                                                          |
| ------------------------- | --------- | --------------------------------------------------------------- |
| `brand.orange` (primária) | `#FE5000` | acento do "à" e símbolo **un** laranja (≈ Pantone Orange 021 C) |
| `brand.orangeLine`        | `#F05426` | padrão gráfico "Diversos UN" (contorno)                         |
| `brand.black`             | `#000000` | logotipo UNITÀ                                                  |
| `brand.ink`               | `#231F20` | símbolo **un** preto (preto de impressão)                       |

Tipografia: os arquivos não trazem fonte. O logotipo usa sans geométrica de terminais retos. Proposta: **Inter** (UI, com `tabular-nums` para números alinhados na grade) + **Sora** para títulos (geométrica, próxima do logotipo). Trocável por token.

Uso dos logos: logotipo completo (UNITÀ ENGENHARIA) no login e cabeçalho largo; símbolo **un** laranja como favicon / sidebar recolhida; padrão "Diversos UN" apenas decorativo (fundo do login, baixa opacidade). Nunca recolorir o acento laranja.

## 2. Arquitetura

```text
┌──────────── apps/web (React + Vite) ────────────┐
│ UI → features → services/api (TanStack Query)   │
└───────────────────────┬──────────────────────────┘
                        │ HTTPS  /api/v1  (JSON + cookie refresh)
┌───────────────────────▼──────────────────────────┐
│ apps/api (Fastify)                               │
│  routes → application services → repositories   │
│                 │                                │
│                 ▼                                │
│   packages/engine  (ProjectionEngine — puro TS)  │
└───────────────────────┬──────────────────────────┘
                        ▼
                  PostgreSQL 16
```

**Monorepo npm workspaces**:

| Pacote               | Responsabilidade                                                                                                                | Depende de        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `packages/engine`    | Motor de cálculo determinístico (curvas, períodos, projeção, taxa, recálculo, KPIs, agregação). Sem I/O.                        | `decimal.js`      |
| `packages/contracts` | Schemas Zod dos contratos da API (request/response) + enums. Usado pela API **e** pelo web → validação idêntica nos dois lados. | `zod`             |
| `apps/api`           | Fastify, auth, RBAC, persistência (Drizzle), auditoria, OpenAPI.                                                                | engine, contracts |
| `apps/web`           | Apresentação e interação. **Não calcula** — exibe o que a API devolve.                                                          | contracts         |

O engine é consumível futuramente por Power BI/Excel/automação via API, sem duplicar regra (princípio SSOT, seção 40).

### 2.1 Decisões principais (ADRs)

| #   | Decisão                                                                                                                                                                                                           | Motivo                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 001 | Monorepo com `engine` e `contracts` isolados                                                                                                                                                                      | Portabilidade do domínio; mesmo schema no front e back                                                                  |
| 002 | **Drizzle ORM** + `pg` (em vez de Prisma)                                                                                                                                                                         | Sem binário nativo de query engine → deploy simples na VPS Hostinger; SQL tipado; migrations SQL versionadas e legíveis |
| 003 | `decimal.js` em todo cálculo; `numeric` no Postgres; valores trafegam como **string** no JSON                                                                                                                     | Zero erro de ponto flutuante de ponta a ponta                                                                           |
| 004 | Percentuais armazenados como **fração** `NUMERIC(12,8)` (= percentual com 6 casas)                                                                                                                                | Compatível com Excel (0,0147) e precisão ≥ `DECIMAL(10,6)` da especificação                                             |
| 005 | Curvas **imutáveis por versão**                                                                                                                                                                                   | Toda alteração de pontos cria `curve_versions.version + 1`; obras apontam para uma versão                               |
| 006 | Access token JWT curto (15 min, em memória) + refresh token opaco rotativo em cookie `HttpOnly; Secure; SameSite=Strict` (hash no banco)                                                                          | Sessão persistente sem expor token ao JS; revogação possível                                                            |
| 007 | Senhas com **Argon2id** (`@node-rs/argon2`, binários pré-compilados)                                                                                                                                              | Padrão OWASP atual                                                                                                      |
| 008 | Hostinger **VPS**: Nginx (TLS Let's Encrypt) → `dist/` estático + proxy `/api` → Node (PM2/systemd) → PostgreSQL local                                                                                            | Um domínio só (`/api`) evita CORS em produção e simplifica cookies                                                      |
| 009 | Tailwind v4 com tokens em `@theme` (CSS) como única fonte; `tokens.ts` reexpõe as variáveis para uso em TS/gráficos                                                                                               | Nenhuma cor espalhada pelo código                                                                                       |
| 010 | Vite 7 + Vitest 3 fixados (não Vite 8/Vitest 4)                                                                                                                                                                   | Bug do npm 10 na resolução de peers opcionais do Vitest 4; revisar na Fase 9                                            |
| 011 | A prévia de término no formulário e a validação instantânea de curvas usam o **mesmo** `@unita/engine` no navegador                                                                                               | Feedback imediato sem duplicar regra; o backend revalida tudo ao salvar                                                 |
| 012 | Cada salvamento de edições/recálculo cria **nova versão** da projeção; leitura reconstrói a partir dos valores gravados (`hydrateProjection`)                                                                     | Versões antigas ficam exatamente como foram calculadas                                                                  |
| 013 | **Curva própria da obra** versionada (`work_actual_curves`), recebida por endpoint genérico; regra de vigência no engine (`resolveEffectiveCurve`)                                                                | Sistema de origem ainda indefinido → contrato estável; adaptador específico entra na Integration Layer depois           |
| 014 | Integrações autenticam por **`X-Api-Key`** (`INTEGRATION_API_KEYS`, comparação em tempo constante), só nas rotas de curva própria/sync                                                                            | Sistemas máquina-a-máquina sem sessão; auditoria registra `metadata.integration`                                        |
| 016 | Integração **Microsoft Graph app-only** (client credentials, sem SDK) lendo `usedRange` da aba BD_Infos Gerais; porta `WorkCurveProvider` + adaptador `GraphWorkCurveProvider`; casamento por nome padrão da obra | Credenciais só no servidor; trocar a fonte (ERP, outra planilha) = novo adaptador, sem tocar no domínio                 |
| 015 | Consolidado e “Curvas das obras” carregam a carteira com nº fixo de consultas (sem N+1) e calculam tudo no engine                                                                                                 | SSOT: a web só exibe; mesma fonte para futuros Power BI/Excel                                                           |

## 3. Modelo de dados

```text
users ─┬─< refresh_tokens
       ├─< password_reset_tokens
       └─< audit_logs >── works
clients ─< works >── curve_versions >── curves
                       │
curve_versions ─< curve_points
works ─< projections ─< projection_values
```

| Tabela                     | Campos principais                                                                                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`                    | id (uuid), name, email (único, lower), password_hash, role (`ADMIN`/`EDITOR`/`VIEWER`), is_active, timestamps                                                                                                                                                                |
| `refresh_tokens`           | id, user_id, token_hash, expires_at, revoked_at, replaced_by                                                                                                                                                                                                                 |
| `password_reset_tokens`    | id, user_id, token_hash, expires_at, used_at                                                                                                                                                                                                                                 |
| `clients`                  | id, name (único)                                                                                                                                                                                                                                                             |
| `curves`                   | id, name, description, type (`PHYSICAL`), status (`ACTIVE`/`ARCHIVED`), timestamps                                                                                                                                                                                           |
| `curve_versions`           | id, curve_id, version (único por curva), periods, notes, created_by, created_at                                                                                                                                                                                              |
| `curve_points`             | curve_version_id, period (1..n), monthly_pct `NUMERIC(12,8)`, cumulative_pct `NUMERIC(12,8)` — PK composta                                                                                                                                                                   |
| `works`                    | id, name, client_id, units (>0), budget `NUMERIC(18,2)`, fee_rate `NUMERIC(12,8)`, fee_lag_months (≥0), construction_system, curve_version_id, start_date (date), duration_months (>0), status (`DRAFT`/`ACTIVE`/`COMPLETED`/`ARCHIVED`), created_by, timestamps, deleted_at |
| `projections`              | id, work_id, version (único por obra), curve_version_id, curve_source (`PARAMETRIC`/`WORK_ACTUAL`), work_actual_curve_id, parameters (jsonb snapshot), is_current, reference_date, created_by, created_at, note                                                              |
| `projection_values`        | projection_id, series (`PHYSICAL`/`FEE`), period_index, period_month (date, dia 1), original_value `NUMERIC(20,8)`, current_value `NUMERIC(20,8)`, origin (`CURVE`/`MANUAL`) — PK (projection_id, series, period_index)                                                      |
| `work_actual_curves`       | id, work_id, version (único por obra), start_month, periods, source, external_ref, note, is_current (1 por obra), received_via (`USER`/`API_KEY`), created_by, created_at                                                                                                    |
| `work_actual_curve_points` | actual_curve_id, period, monthly_pct `NUMERIC(12,8)`, cumulative_pct `NUMERIC(12,8)` — PK composta                                                                                                                                                                           |
| `work_progress_indicators` | work_id, month (PK composta), realized_cumulative, client_replanned_cumulative, target_cumulative `NUMERIC(12,8)` (nulos permitidos), source, external_ref, received_via, updated_by, updated_at — cada envio substitui o histórico da obra                                  |
| `fee_recalibrations`       | id, work_id, reference_month, from_month (= referência + 1), remaining_total `NUMERIC(18,2)`, previous_remaining, note, is_current (1 por obra), created_by, created_at, cleared_at — histórico imutável do “Ajuste projeção taxa”                                           |
| `audit_logs`               | id, user_id, action, entity, entity_id, work_id, field, old_value, new_value, origin, metadata jsonb, created_at                                                                                                                                                             |

Índices: `works(client_id)`, `works(status)`, `projections(work_id, is_current)`, `audit_logs(work_id, created_at desc)`, `audit_logs(entity, entity_id)`.

`end_date` e `periods` **não são colunas**: são derivados pelo engine (evita dado duplicado divergente). A API os devolve calculados.

## 4. Contratos da API (`/api/v1`)

Erros padronizados: `{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [...] } }`.
Valores decimais sempre como **string** (`"29254015.86"`, `"0.01475436"`). Documentação em `/api/docs` (OpenAPI 3).

| Método         | Rota                                          | Papel mínimo            | Descrição                                                                                                                                                                                                                                     |
| -------------- | --------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST           | `/auth/register`                              | público*                | Cadastro (1º usuário vira ADMIN; demais VIEWER até promoção)                                                                                                                                                                                  |
| POST           | `/auth/login`                                 | público                 | Retorna `accessToken` + cookie refresh                                                                                                                                                                                                        |
| POST           | `/auth/refresh`                               | cookie                  | Rotaciona refresh, novo access                                                                                                                                                                                                                |
| POST           | `/auth/logout`                                | autenticado             | Revoga refresh                                                                                                                                                                                                                                |
| POST           | `/auth/forgot-password`                       | público                 | Sempre 204 (não revela e-mail)                                                                                                                                                                                                                |
| POST           | `/auth/reset-password`                        | público                 | token + nova senha                                                                                                                                                                                                                            |
| GET            | `/auth/me`                                    | autenticado             | Usuário corrente                                                                                                                                                                                                                              |
| GET/POST       | `/works`                                      | VIEWER / EDITOR         | Lista paginada (filtros: status, clientId, q) / cria + projeção V1                                                                                                                                                                            |
| GET/PUT/DELETE | `/works/:id`                                  | VIEWER / EDITOR / ADMIN | Detalhe (com término calculado) / edita / exclui (só sem histórico manual; senão arquivar)                                                                                                                                                    |
| POST           | `/works/:id/duplicate` · `/works/:id/archive` | EDITOR                  |                                                                                                                                                                                                                                               |
| GET/POST       | `/curves`                                     | VIEWER / ADMIN          | Lista / cria curva + V1                                                                                                                                                                                                                       |
| GET/PUT        | `/curves/:id`                                 | VIEWER / ADMIN          | Detalhe com versão atual / PUT com `points` gera nova versão                                                                                                                                                                                  |
| GET            | `/curves/:id/versions/:version`               | VIEWER                  | Versão específica                                                                                                                                                                                                                             |
| POST           | `/curves/validate`                            | VIEWER                  | Valida pontos sem salvar (feedback no formulário)                                                                                                                                                                                             |
| GET            | `/projections/:workId`                        | VIEWER                  | Projeção corrente (séries, acumulados, KPIs)                                                                                                                                                                                                  |
| POST           | `/projections/:workId/calculate`              | EDITOR                  | `{ mode: "PRESERVE_MANUAL" \| "REPLACE_MANUAL", dryRun?: boolean }` → nova versão; `dryRun` devolve o impacto (qtd de manuais)                                                                                                                |
| PUT            | `/projections/:workId`                        | EDITOR                  | Edição de células `{ changes: [{ series, periodIndex, value }] }` + auditoria                                                                                                                                                                 |
| GET            | `/projections/:workId/versions`               | VIEWER                  | Histórico de versões                                                                                                                                                                                                                          |
| GET            | `/works/:id/audit`                            | VIEWER                  | Histórico de alterações                                                                                                                                                                                                                       |
| GET/PUT        | `/works/:id/actual-curve`                     | VIEWER / EDITOR ou key  | Curva própria (atual, versões, curva em vigor) / recebe nova versão e aplica à projeção se a obra já iniciou                                                                                                                                  |
| GET            | `/work-curves`                                | VIEWER                  | Curva em vigor de cada obra no eixo mensal + contagem por situação + `needsRecalc`                                                                                                                                                            |
| POST           | `/work-curves/sync`                           | EDITOR ou key           | Recalcula (ou marca para revisão) projeções geradas com curva que não está mais em vigor                                                                                                                                                      |
| GET            | `/integrations/status`                        | VIEWER                  | Integrações configuradas (Microsoft Graph)                                                                                                                                                                                                    |
| POST           | `/integrations/work-curves/sync`              | EDITOR ou key           | Importa curvas próprias da aba BD_Infos Gerais (`dryRun` simula) → relatório por obra                                                                                                                                                         |
| GET            | `/portfolio/consolidated`                     | VIEWER                  | Consolidado da carteira (Painel (2)): taxa por mês/ano, acumulado no ano, obras ativas, recebida × a receber; por obra: UH, início (1º mês da curva), término projetado (100%), avanço realizado, status cliente, taxa do mês, ajuste de taxa |
| GET/PUT        | `/works/:id/progress-indicators`              | VIEWER / EDITOR ou key  | Indicadores mensais (Realizado Acumulado, Replanejado Atual Acumulado - Cliente, Meta Acumulada - Atual) — PUT substitui o histórico                                                                                                          |
| PUT/DELETE     | `/works/:id/fee-recalibration`                | EDITOR                  | “Ajuste projeção taxa”: `{ referenceMonth, remainingTotal, note? }` → nova versão da projeção; DELETE remove o ajuste                                                                                                                         |

## 5. Motor de cálculo (`packages/engine`)

Entrada:

```ts
{ startDate: '2027-01-01', durationMonths: 24, curve: CurvePoint[], budget: '29254015.86',
  feeRate: '0.10', feeLagMonths: 1, manual?: ManualCell[], mode?: 'PRESERVE_MANUAL'|'REPLACE_MANUAL' }
```

Saída: `{ schedule, periods[], physical: SeriesCell[], fee: SeriesCell[], totals, validations[] }`.

Regras matemáticas (detalhadas em `docs/CALCULATION_RULES.md`):

1. **Cronograma** — período 1 = mês da data de início (competência). `término = último dia do mês (início + duração − 1)`. Ex.: 01/01/2027 + 24 → 31/12/2028.
2. **Validação de curva** — mensais ≥ 0; acumulado não decrescente; soma = 1 (tolerância 1e-8); acumulado final = 1; períodos contíguos 1..n.
3. **Reamostragem** — se a curva tem `n` pontos e a obra `D` meses, a curva é tratada como função acumulada contínua F(t), t∈[0,1], com interpolação linear entre os pontos; `%mês k = F(k/D) − F((k−1)/D)`. Se `n = D` o resultado é idêntico à curva.
4. **Arredondamento** — `ROUND_HALF_EVEN` (bancário). Percentuais a 8 casas (fração); dinheiro a 2 casas. Distribuição por **maior resto** (Hamilton) garante Σ% = 1,00000000 e Σ taxa = taxa total exata, centavo a centavo.
5. **Taxa** — `taxaTotal = round2(orçamento × taxa%)`; `taxa_bruta(k + defasagem) = taxaTotal × %físico(k)`; horizonte financeiro = D + defasagem meses.
6. **Ajustes manuais** — cada célula guarda `original` (curva), `current` e `origin`. Recalcular:
   - `REPLACE_MANUAL`: tudo volta à curva.
   - `PRESERVE_MANUAL`: células manuais mantidas; o restante `1 − Σmanuais` é redistribuído nas células de curva **proporcionalmente aos pesos da curva** (total segue 100%). Σmanuais > 100% → erro de validação.
   - Célula de taxa manual é mantida; demais taxas recebem o saldo proporcionalmente.
7. **KPIs** — a partir de uma data de referência: projetado total, realizado (≤ ref), restante, % acumulado físico, duração, término.
8. **Carteira** — soma mensal por série, acumulado no ano (reinicia em janeiro), obras ativas por mês.

## 6. Ambiguidades identificadas (e decisão provisória)

| #   | Ambiguidade                                                            | Decisão provisória                                                                                              |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| A1  | Curva com nº de pontos ≠ duração da obra                               | Reamostragem linear do acumulado (regra 3). Alternativa: exigir curva com mesma duração.                        |
| A2  | Início no meio do mês                                                  | Competência mensal: período 1 = mês de início, término = fim do último mês. Pró-rata diário fica para o futuro. |
| A3  | "Valor realizado"                                                      | Nesta fase = valores até a data de referência. Módulo de realizado real (medições/recebimentos) é fase futura.  |
| A4  | Edição manual de % físico afeta a taxa?                                | Sim: taxa deriva do físico final, exceto células de taxa manuais.                                               |
| A5  | Quem pode se cadastrar                                                 | 1º usuário = ADMIN; demais entram como VIEWER e o ADMIN promove.                                                |
| A6  | Envio de e-mail (recuperar senha)                                      | Interface `Mailer` com adaptador de console em dev; SMTP (Hostinger Mail) em produção.                          |
| A7  | Fase 10 da especificação cita Vercel/Supabase, seção 32 cita Hostinger | Seguimos **Hostinger VPS** (confirmado). Código permanece portável.                                             |
| A8  | Colunas gerenciais da planilha (IEC, INCC, áreas, equipe)              | Fora das fases 1–5; entram como atributos da obra numa fase posterior.                                          |

## 7. Plano de implementação

| Fase           | Entrega                                                            | Status       |
| -------------- | ------------------------------------------------------------------ | ------------ |
| 1 Fundação     | monorepo, TS strict, ESLint/Prettier, tokens, schema + migrations  | nesta sessão |
| 2 Autenticação | register/login/refresh/logout/forgot/reset, RBAC, rotas protegidas | nesta sessão |
| 3 Obras        | CRUD, formulário, validações, término calculado                    | nesta sessão |
| 4 Curvas       | CRUD, versionamento, validação, gráfico                            | nesta sessão |
| 5 Motor        | ProjectionEngine + testes                                          | nesta sessão |
| 6 Grade        | grade horizontal virtualizada, edição tipo Excel, totais           | próxima      |
| 7 Histórico    | telas de auditoria e comparação de versões                         | próxima      |
| 8 API          | endurecimento, docs completas, testes de API                       | parcial      |
| 9 Performance  | virtualização, cache, índices                                      | próxima      |
| 10 Deploy      | guia Hostinger VPS (Nginx + PM2 + Postgres)                        | guia inicial |
