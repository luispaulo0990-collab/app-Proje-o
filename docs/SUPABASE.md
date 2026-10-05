# Banco de dados no Supabase (com Vercel)

Os dados do Painel de Obras ficam no PostgreSQL do projeto Supabase da Unità. A aplicação acessa o
banco **somente pela nossa API** (`/api/v1`). Os usuários são criados no **Supabase →
Authentication** (seção 4); o nível de acesso fica na tabela `users`. A Data API (REST automática)
do Supabase fica fechada para as nossas tabelas.

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
| `AUTH_PROVIDER`          | `supabase`                                     |
| `SUPABASE_URL`           | `https://fshyhsoyjcdtubpskfak.supabase.co`     |
| `SUPABASE_PUBLISHABLE_KEY` | a chave `sb_publishable_…` (nunca a secret)  |
| `NODE_ENV`               | `production`                                   |
| `CORS_ORIGIN`/`APP_URL`  | `https://seu-dominio`                          |
| `COOKIE_SECURE`          | `true`                                         |
| `TRUST_PROXY`            | `true`                                         |

O build da Vercel (`npm run build:vercel`) já aplica as migrations e a carga idempotente usando
`DATABASE_MIGRATION_URL`. Depois do deploy, o site passa a ler e gravar no Supabase.

### SharePoint (Microsoft Graph) na Vercel

- Variáveis: `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MS_GRAPH_DRIVE_ID`,
  `MS_GRAPH_ITEM_ID` (as demais têm padrão) — as mesmas do `integracao-microsoft.txt`.
- Importação manual: **Curvas das obras → Simular / Importar curvas e IEC** (EDITOR ou ADMIN).
- Importação automática: Vercel Cron todo dia às 06:00 (09:00 UTC) chama
  `GET /api/v1/integrations/work-curves/cron` com `Authorization: Bearer CRON_SECRET`
  (variável `CRON_SECRET` na Vercel). No histórico aparece como integração “agendamento”.
- A função tem até 300 s (`vercel.json` → `functions`), suficiente para ler as abas e recalcular.
- **Sem segredo (federação de identidade):** na Vercel a API entra na Microsoft com o token OIDC
  do próprio deploy (`x-vercel-oidc-token` → `client_assertion`). Configuração única:
  1. Vercel → Settings → Security → **OIDC Federation**: ligado, issuer mode **Team**.
  2. Entra ID → aplicativo → Certificados e segredos → **Credenciais federadas** → Adicionar →
     cenário **Outro emissor**:
     - Emissor: `https://oidc.vercel.com/tx-c`
     - Identificador do assunto: `owner:tx-c:project:painel-obras-unita:environment:production`
     - Público: `https://vercel.com/tx-c`
  3. Testar “Simular”. Funcionando, apagar `MS_GRAPH_CLIENT_SECRET` da Vercel e o segredo no Entra
     (enquanto existir, ele é usado só se a federação falhar).
- Permissões: preferir `Sites.Selected` com leitura liberada só no site da planilha, em vez de
  `Sites.Read.All`.
- Renomear a equipe ou o projeto na Vercel muda o identificador do assunto: atualize a credencial
  federada.

## 4. Usuários (Supabase → Authentication)

O cadastro pela tela inicial do app fica desligado (`AUTH_PROVIDER=supabase`). O Supabase guarda e
confere as senhas; a tabela `users` guarda nome, papel e se o usuário está ativo.

**Criar um usuário**

1. **Authentication → Users → Add user → Create new user**: e-mail e senha, marque **Auto Confirm
   User**. (Ou **Send invitation**: a pessoa recebe um e-mail e define a senha na tela
   `/redefinir-senha` do app.)
2. Na mesma hora aparece uma linha em **Table Editor → users** com `role = VIEWER`.
3. Troque `role` para o nível desejado e salve:

| `role`   | Pode                                                             |
| -------- | ---------------------------------------------------------------- |
| `VIEWER` | só visualizar                                                    |
| `EDITOR` | criar/editar obras, projeções, taxa emitida, INCC, integrações   |
| `ADMIN`  | tudo, inclusive curvas paramétricas e usuários                   |

- A mudança de papel vale em até 15 minutos (ou no próximo login).
- Para bloquear alguém: `is_active = false` em `users` (ou exclua o usuário em Authentication, o
  que também o desativa — o histórico de alterações dele é mantido).
- Usuários copiados da demonstração são vinculados pelo **mesmo e-mail**: crie-os em Authentication
  com o mesmo e-mail e eles mantêm o papel que já tinham.
- Nome exibido: vem de `user_metadata.name` (ou `full_name`) se houver; senão, da parte do e-mail
  antes do `@`. Pode ser corrigido em `users.name`.

Como funciona: gatilhos em `auth.users` (instalados automaticamente a cada deploy) criam/vinculam o
perfil em `users`, acompanham a troca de e-mail e desativam quem for excluído. Se o Supabase não
permitir os gatilhos, o deploy só registra um aviso e o perfil é criado/vinculado no primeiro login.

**Configurar os links de e-mail** (recuperação de senha e convite) em **Authentication → URL
Configuration**:

- **Site URL**: o endereço do app (ex.: `https://painel-obras.vercel.app`);
- **Redirect URLs**: adicione `https://SEU-ENDERECO/redefinir-senha`.

O Supabase envia esses e-mails pelo servidor dele, com limite baixo de envios por hora. Para uso
diário, configure um SMTP próprio em **Authentication → Emails → SMTP Settings** (ex.: o e-mail da
Hostinger).

## 5. Segurança

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

## 6. Voltar a usar o banco local

Apague `DATABASE_URL` do `.env`. A demonstração (`iniciar-demo.bat`) continua usando sempre o banco
local `.demo-data`, independentemente do `.env`.
