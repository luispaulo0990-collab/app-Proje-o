# Deploy — Hostinger VPS

Arquitetura (ADR 008): **um domínio**, Nginx servindo o frontend estático e fazendo proxy de `/api` para o Node.

```text
https://painel.seudominio.com.br
        │  Nginx (TLS Let's Encrypt)
        ├── /            → /var/www/unita/web (apps/web/dist)
        └── /api/        → http://127.0.0.1:3333  (PM2: unita-api)
                                   │
                              PostgreSQL 16 (local, porta 5432, sem acesso externo)
```

Vantagens: sem CORS em produção, cookie de sessão `SameSite=Strict` funciona, um só certificado.

## 1. Preparar a VPS (Ubuntu 24.04, uma vez)

```bash
ssh root@IP_DA_VPS
adduser deploy && usermod -aG sudo deploy
apt update && apt upgrade -y
apt install -y nginx postgresql-16 git ufw certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm install -g pm2
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

## 2. Banco de dados

```bash
sudo -u postgres psql <<'SQL'
CREATE USER unita WITH PASSWORD 'SENHA_FORTE_AQUI';
CREATE DATABASE unita OWNER unita;
SQL
```

O Postgres escuta só em `localhost` (padrão). Backup diário sugerido:

```bash
# /etc/cron.daily/unita-backup
pg_dump -U unita -h localhost unita | gzip > /var/backups/unita-$(date +%F).sql.gz
find /var/backups -name 'unita-*.sql.gz' -mtime +30 -delete
```

## 3. Código e variáveis de ambiente

```bash
sudo mkdir -p /var/www/unita && sudo chown deploy /var/www/unita
su - deploy
git clone <repo> /var/www/unita/app && cd /var/www/unita/app
cp .env.example .env && nano .env
```

Valores de produção (`.env` **nunca** vai para o git):

```env
NODE_ENV=production
HOST=127.0.0.1
PORT=3333
DATABASE_URL=postgres://unita:SENHA_FORTE_AQUI@localhost:5432/unita
AUTH_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))">
CORS_ORIGIN=https://painel.seudominio.com.br
APP_URL=https://painel.seudominio.com.br
TRUST_PROXY=true
COOKIE_SECURE=true
ALLOW_PUBLIC_REGISTRATION=false   # após criar o 1º admin
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=no-reply@seudominio.com.br
SMTP_PASS=...
```

## 4. Build, migrations e primeira execução

```bash
npm ci
npm run build                 # engine → contracts → api → web
npm run db:migrate:prod --workspace=@unita/api
# opcional: curvas padrão + admin inicial (SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD no .env)
npm run db:seed
cp -r apps/web/dist/. /var/www/unita/web/
pm2 start apps/api/dist/server.js --name unita-api --node-args="--env-file=/var/www/unita/app/.env"
pm2 save && pm2 startup
```

> Se usar o seed em produção, remova `SEED_ADMIN_PASSWORD` do `.env` depois.

## 5. Nginx + HTTPS

`/etc/nginx/sites-available/unita`:

```nginx
server {
  server_name painel.seudominio.com.br;
  root /var/www/unita/web;
  index index.html;

  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;
  add_header X-Frame-Options DENY always;

  location /api/ {
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 2m;
  }

  location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
  location / { try_files $uri /index.html; }   # SPA
}
```

```bash
sudo ln -s /etc/nginx/sites-available/unita /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d painel.seudominio.com.br   # HTTPS + renovação automática
```

## 6. Domínio

No hPanel → DNS do domínio: registro **A** `painel` → IP da VPS (TTL 300). Aguarde a propagação antes do certbot.
Para `api.seudominio.com.br` separado no futuro: novo server block + `CORS_ORIGIN` com o domínio do front (o código já suporta).

## 7. Atualizar a aplicação

```bash
cd /var/www/unita/app
git fetch --tags && git checkout vX.Y.Z      # sempre por tag
npm ci && npm run build
npm run db:migrate:prod --workspace=@unita/api
rsync -a --delete apps/web/dist/ /var/www/unita/web/
pm2 reload unita-api                          # zero-downtime
curl -s https://painel.seudominio.com.br/api/v1/health
```

## 8. Rollback

1. `git checkout <tag anterior> && npm ci && npm run build`
2. Republicar `apps/web/dist` e `pm2 reload unita-api`.
3. Migrations são aditivas por política; se uma migration precisar ser desfeita, restaure o backup do dia (`gunzip -c backup.sql.gz | psql ...`) **antes** de subir a versão anterior.

## 8.1 Sincronização agendada das curvas (SharePoint)

Com as variáveis `MS_GRAPH_*` no `.env`, agende a importação diária (ex.: 6h) no `crontab -e` do usuário da aplicação:

```cron
0 6 * * * cd /var/www/unita-projecoes && npm run integrations:sync-curves:prod --workspace=@unita/api >> /var/log/unita/sync-curves.log 2>&1
```

A VPS precisa de saída HTTPS para `login.microsoftonline.com` e `graph.microsoft.com`. Use `-- --dry` para simular.

## 9. Observabilidade

- Logs: `pm2 logs unita-api` (JSON do Pino; senhas, tokens e cookies são redigidos).
- Saúde: `GET /api/v1/health` (inclui checagem do banco) — pode ser usado por um monitor externo (UptimeRobot etc.).
- Documentação da API: `https://painel.seudominio.com.br/api/docs` (restrinja no Nginx se desejar).

## Portabilidade

Nada no código depende da Hostinger: qualquer VPS/cloud com Node 22 + PostgreSQL roda o mesmo build. O motor de cálculo não conhece servidor, banco nem navegador.
