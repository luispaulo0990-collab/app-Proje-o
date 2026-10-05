# Banco de dados no Supabase (com Vercel)

Os dados do Painel de Obras ficam no PostgreSQL do projeto Supabase da Unità. A aplicação continua
acessando o banco **somente pela nossa API** (`/api/v1`): login, permissões, auditoria e o motor de
cálculo não mudam. O Supabase é usado como servidor PostgreSQL gerenciado — não usamos o Supabase
Auth nem a Data API (REST automática), que ficam fechadas para as nossas tabelas.

## 1. Pegar as conexões no Supabase

No painel do projeto: **Connect** (topo) ou **Project Settings → Database → Connection string**.

| Uso                                       | Modo no Supabase   | Porta  | Variável                 |
| ----------------------------------------- | ------------------ | ------ | ------------------------ |
| Aplicação na Vercel (funções serverless)  | Transaction pooler | `6543` | `DATABASE_URL`           |
| Migrations, carga inicial, cópia de dados | Session pooler     | `5432` | `DATABASE_MIGRATION_URL` |

Formato (troque `SEU-PROJETO` e a senha do banco; se a senha tiver `@`, `#`, `/` ou `:`, codifique —
ex.: `@` → `%40`):

```text
postgresql://postgres.SEU-PROJETO:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
postgresql://postgres.SEU-PROJETO:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
```

Não use a “Direct connection” (`db.SEU-PROJETO.supabase.co`) na Vercel: ela só aceita IPv6.

### Certificado (recomendado)

**Project Settings → Database → SSL Configuration → Download certificate** (`prod-ca-2021.crt`).
Coloque o conteúdo em `DATABASE_SSL_CA` (o texto PEM inteiro, o PEM em base64 ou, no PC, o caminho
do arquivo). Com o certificado a conexão é criptografada **e verificada**; sem ele, só
criptografada (`DATABASE_SSL=auto` decide sozinho).

## 2. Copiar os dados da demonstração para o Supabase (uma vez)

Leva tudo o que já foi lançado no PC (pasta `.demo-data`): usuários e senhas, obras, curvas e
versões, projeções e ajustes manuais, taxas emitidas, INCC, indicadores e histórico.

1. Feche a janela da demonstração (`iniciar-demo.bat`), se estiver aberta.
2. Na raiz do projeto, crie/edite o arquivo `.env` com pelo menos:

   ```env
   DATABASE_URL=postgresql://postgres.SEU-PROJETO:SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
   DATABASE_MIGRATION_URL=postgresql://postgres.SEU-PROJETO:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres
   DATABASE_SSL_CA=C:\caminho\para\prod-ca-2021.crt
   ```

3. Dê duplo clique em **`copiar-para-supabase.bat`** (ou `npm run db:copy`).

O script cria as tabelas no Supabase (migrations), copia tudo numa única transação e confere
tabela por tabela (hash SHA-256 de todas as linhas) — se algo divergir, nada é gravado. Se o
Supabase já tiver usuários, ele para e pede confirmação: rode `npm run db:copy -- --substituir`
para apagar os dados de lá e copiar de novo. As curvas padrão e o INCC criados por um deploy
anterior são substituídos automaticamente pela cópia.

## 3. Configurar a Vercel

**Project → Settings → Environment Variables** (Production):

| Variável                 | Valor                                          |
| ------------------------ | ---------------------------------------------- |
| `DATABASE_URL`           | Transaction pooler (porta 6543)                |
| `DATABASE_MIGRATION_URL` | Session pooler (porta 5432)                    |
| `DATABASE_POOL_MAX`      | `3`                                            |
| `DATABASE_SSL_CA`        | conteúdo do `prod-ca-2021.crt` (PEM ou base64) |
| `AUTH_SECRET`            | o mesmo usado hoje (trocar desloga todo mundo) |
| `NODE_ENV`               | `production`                                   |
| `CORS_ORIGIN`/`APP_URL`  | `https://seu-dominio`                          |
| `COOKIE_SECURE`          | `true`                                         |
| `TRUST_PROXY`            | `true`                                         |

O build da Vercel (`npm run build:vercel`) já aplica as migrations e a carga idempotente usando
`DATABASE_MIGRATION_URL`. Depois do deploy, o site passa a ler e gravar no Supabase.

## 4. Segurança

- Toda migration termina com um passo automático (`hardenForSupabase`): **RLS ligado em todas as
  tabelas, sem políticas**, e sem permissões para os papéis `anon`/`authenticated`. Assim a chave
  pública (`anon key`) do Supabase não lê nem grava nada — nem mesmo a tabela de usuários. Tabelas
  criadas no futuro também nascem fechadas.
- A aplicação conecta como dono das tabelas (`postgres`), que não é afetado pelo RLS.
- Nunca coloque a senha do banco, a `service_role key` ou o `.env` no GitHub (o `.gitignore` já
  ignora `.env`).
- Opcional: em **Project Settings → API**, remova `public` de “Exposed schemas” para desligar de vez
  a Data API.
- Backups: o Supabase faz backup diário (Point-in-Time Recovery é opcional, plano pago).

## 5. Voltar a usar o banco local

Apague `DATABASE_URL` do `.env`. A demonstração (`iniciar-demo.bat`) continua usando sempre o banco
local `.demo-data`, independentemente do `.env`.
