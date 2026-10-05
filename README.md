# Painel de Obras — Unità Engenharia

Sistema de **projeção físico-financeira de obras** baseado em curvas paramétricas versionadas, com ajustes manuais rastreáveis. Substitui gradualmente o controle "Painel de obras.xlsx".

> Princípio central: a interface é só uma camada. **Todo cálculo vive no `ProjectionEngine`** (`packages/engine`), puro, determinístico e testado — a mesma regra serve a web, a API e futuras integrações (Power BI, Excel, ERP).

## Status

| Fase           | Entrega                                                                                                      | Situação  |
| -------------- | ------------------------------------------------------------------------------------------------------------ | --------- |
| 1 Fundação     | monorepo, TS strict, ESLint/Prettier, design tokens, schema + migrations                                     | ✅        |
| 2 Autenticação | cadastro, login, sessão persistente (refresh rotativo), recuperação de senha, RBAC                           | ✅        |
| 3 Obras        | CRUD, duplicar, arquivar, exclusão protegida, validações front + back                                        | ✅        |
| 4 Curvas       | CRUD, versionamento imutável, validação, gráfico, colar do Excel, normalizar                                 | ✅        |
| 5 Motor        | cronograma, reamostragem, taxa (competência M−1, emissão + INCC), ajustes manuais, recálculo, KPIs, carteira | ✅        |
| 6 Grade        | grade editável estilo Excel, virtualizada, visão de carteira                                                 | próxima   |
| 7–10           | histórico/comparação de versões, endurecimento da API, performance, deploy                                   | planejado |

Uma prévia somente leitura da grade horizontal já está na tela de projeção.

## Arquitetura

```text
apps/web  (React 19 + Vite + Tailwind 4 + TanStack Query + RHF/Zod)
   │  HTTPS /api/v1  (access token em memória + refresh em cookie HttpOnly)
apps/api  (Fastify 5 + Zod + Drizzle ORM)
   ├── packages/engine     ← ProjectionEngine (decimal.js, sem I/O)
   └── PostgreSQL 16
packages/contracts         ← schemas Zod compartilhados (validação idêntica front/back)
```

Documentos:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — análise da planilha e da identidade visual, decisões (ADRs), modelo de dados, contratos, ambiguidades e plano.
- [`docs/CALCULATION_RULES.md`](docs/CALCULATION_RULES.md) — regras matemáticas do motor.
- [`docs/DEPLOY_HOSTINGER.md`](docs/DEPLOY_HOSTINGER.md) — deploy na VPS Hostinger (Nginx + PM2 + PostgreSQL), atualização e rollback.

### Estrutura

```text
apps/
  api/
    drizzle/                 migrations SQL versionadas
    src/
      config/                env validado com Zod
      database/              schema, client, repositories, migrate, seed
      middleware/            autenticação + autorização por papel
      modules/               auth · users · works · curves · projections
      plugins/               tratamento padronizado de erros
      integrations/          Integration Layer (futuro: Excel, Power BI, ERP)
      services/              mailer (SMTP/console)
    test/                    testes de integração (Postgres real)
  web/
    src/
      app/                   router (code splitting), providers
      components/            ui · layout · charts
      features/              auth · works · curves · projections
      services/api/          client HTTP com refresh automático
      styles/tokens.css      design tokens (fonte única de cores/tipografia)
      utils/                 formatação pt-BR sem ponto flutuante
packages/
  engine/                    ProjectionEngine + testes
  contracts/                 contratos da API
docs/
```

## Testar agora (modo demonstração — Windows)

Só é preciso ter o **Node.js LTS** instalado (https://nodejs.org). Não precisa instalar PostgreSQL.

1. Dê duplo clique em **`iniciar-demo.bat`** (na raiz do projeto).
   - Na primeira vez ele instala as dependências (alguns minutos).
2. O navegador abre em http://localhost:3333.
3. Clique em **Criar conta** — o primeiro usuário vira **ADMIN**.
4. Já vêm carregadas as 2 curvas padrão e as **37 obras da aba Painel (2)** de `Painel de obras.xlsx` (orçamento, % taxa e o avanço físico de cada obra como curva própria). Bumerangue (sem avanço físico) e Parque das Cerejeiras (sem orçamento) não foram importadas.

Os dados ficam na pasta `.demo-data/` (apague-a para recomeçar do zero). Para encerrar, feche a janela preta.
Em outros sistemas: `npm install && npm run demo`.

O modo demonstração usa um PostgreSQL embarcado (PGlite) e serve a API e o site no mesmo endereço. Não é para produção.

## Requisitos

- Node.js **22.9+**
- PostgreSQL **16** (local, Docker ou VPS)

## Instalação e execução local

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e AUTH_SECRET

# banco local via Docker (opcional)
docker compose up -d db       # usuário/senha: unita / unita_dev

npm run db:migrate            # aplica migrations
npm run db:seed               # curvas padrão (+ admin e obras de exemplo, se configurado no .env)
npm run dev                   # API :3333 + Web :5173 (proxy /api)
```

Acesse http://localhost:5173. O **primeiro usuário cadastrado vira ADMIN**; os seguintes entram como VIEWER até serem promovidos.

Documentação interativa da API (OpenAPI/Swagger): http://localhost:3333/api/docs

## Variáveis de ambiente

Veja [`.env.example`](.env.example). As principais:

| Variável                        | Descrição                                         |
| ------------------------------- | ------------------------------------------------- |
| `DATABASE_URL`                  | conexão PostgreSQL (Supabase: pooler 6543)        |
| `DATABASE_MIGRATION_URL`        | migrations/cópia (Supabase: pooler 5432)          |
| `DATABASE_SSL` / `_SSL_CA`      | TLS do banco (`auto`; CA do Supabase = verificado) |
| `AUTH_SECRET`                   | segredo do JWT (≥ 32 caracteres)                  |
| `CORS_ORIGIN`                   | origens permitidas (lista; nunca `*` em produção) |
| `APP_URL`                       | URL do front (links de redefinição de senha)      |
| `COOKIE_SECURE` / `TRUST_PROXY` | `true` em produção atrás do Nginx                 |
| `ALLOW_PUBLIC_REGISTRATION`     | desliga o autocadastro após o bootstrap           |
| `SMTP_*`                        | envio de e-mail de recuperação (Hostinger Mail)   |
| `AUTH_RATE_LIMIT_MAX`           | tentativas/minuto por IP em login/cadastro/reset  |
| `INTEGRATION_API_KEYS`          | `nome:chave,…` para sistemas que enviam curvas    |
| `MS_GRAPH_*`                    | leitura das curvas no SharePoint (ver abaixo)     |

## Banco e migrations

- Produção: **PostgreSQL do Supabase** — passo a passo em [`docs/SUPABASE.md`](docs/SUPABASE.md). Para levar os dados da demonstração (`.demo-data`) para lá: `copiar-para-supabase.bat` (ou `npm run db:copy`), com cópia conferida tabela a tabela.

- Schema em `apps/api/src/database/schema/index.ts` (Drizzle).
- Após alterar o schema: `npm run db:generate` (gera SQL em `apps/api/drizzle/`) → revisar → `npm run db:migrate`.
- Valores monetários `NUMERIC(18,2)`, percentuais `NUMERIC(12,8)` (fração), constraints de integridade no banco.

## Testes e qualidade

```bash
npm test              # engine (69) + API integração (45) + web (3)
npm run typecheck
npm run lint
npm run format:check
```

Os testes da API usam um banco real: por padrão `postgres://unita:unita_dev@localhost:5432/unita_test` (sobrescreva com `TEST_DATABASE_URL`). O schema é recriado a partir das migrations a cada execução.

## Build de produção

```bash
npm run build         # engine → contracts → api (dist/) → web (dist/)
```

## API (`/api/v1`)

| Recurso          | Endpoints                                                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth             | `POST /auth/register · /auth/login · /auth/refresh · /auth/logout · /auth/forgot-password · /auth/reset-password` · `GET /auth/me`           |
| Usuários (ADMIN) | `GET /users` · `PATCH /users/:id`                                                                                                            |
| Obras            | `GET/POST /works` · `GET/PUT/DELETE /works/:id` · `POST /works/:id/duplicate · /works/:id/archive` · `GET /works/:id/audit` · `GET /clients` |
| Curvas           | `GET/POST /curves` · `GET/PUT /curves/:id` · `GET /curves/:id/versions/:version` · `POST /curves/validate`                                   |
| Projeções        | `GET /projections/:workId` · `POST /projections/:workId/calculate` · `PUT /projections/:workId` · `GET /projections/:workId/versions`        |
| Curvas das obras | `GET/PUT /works/:id/actual-curve` (JWT ou `X-Api-Key`) · `GET /work-curves` · `POST /work-curves/sync`                                       |
| Integrações      | `GET /integrations/status` · `POST /integrations/work-curves/sync` (`{ "dryRun": true }` simula)                                             |
| Consolidado      | `GET /portfolio/consolidated?referenceDate=AAAA-MM-DD`                                                                                       |

Erros: `{ "error": { "code", "message", "details" } }`. Decimais sempre como string.

### Curvas próprias vindas do SharePoint (Microsoft Graph)

As curvas das obras iniciadas vêm da aba **BD_Infos Gerais** de `Consolidado Físico - Obras.xlsx`, coluna **Replanejado Atual Acumulado - Obra**, casadas pelo nome da obra cadastrado. Regras em `docs/CALCULATION_RULES.md` §13.

1. No Entra ID (Azure AD), registre um aplicativo → _Certificates & secrets_ → novo segredo.
2. _API permissions_ → Microsoft Graph → **Application** → `Sites.Read.All` (ou `Files.Read.All`) → _Grant admin consent_.
3. Preencha `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET` no `.env` do servidor (drive/item do arquivo já estão no `.env.example`).
4. Use “Simular” e depois “Importar curvas” na aba **Curvas das obras**, ou agende: `npm run integrations:sync-curves:prod --workspace=@unita/api` (ver DEPLOY_HOSTINGER.md). No modo demonstração, basta criar o `.env` na raiz com essas variáveis.

Integrações: sistemas externos (ERP/planejamento) enviam a curva própria de cada obra iniciada com o cabeçalho `X-Api-Key` (chaves em `INTEGRATION_API_KEYS`). Exemplo em `docs/CALCULATION_RULES.md` §11.

Permissões: **VIEWER** lê · **EDITOR** cria/edita obras e projeções · **ADMIN** administra curvas, usuários e exclusões.

## Segurança

Argon2id · JWT curto (15 min) + refresh opaco rotativo com detecção de reuso · cookie `HttpOnly; Secure; SameSite=Strict` · RBAC no backend · validação Zod em todas as entradas · SQL parametrizado (Drizzle) · Helmet · CORS explícito · rate limiting · logs com redação de senhas/tokens · segredos só via ambiente.
