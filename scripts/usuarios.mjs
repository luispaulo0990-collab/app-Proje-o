/**
 * Utilitário local da demonstração: lista usuários e redefine senha no banco embarcado.
 *
 *   node scripts/usuarios.mjs                              → lista usuários
 *   node scripts/usuarios.mjs redefinir <email> <senha>    → define nova senha
 *
 * Banco padrão: .demo-data/db (na raiz do projeto). Outro banco: DEMO_DB=<pasta>.
 * FECHE A DEMONSTRAÇÃO ANTES: o banco embarcado só aceita um processo por vez.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { hash } from '@node-rs/argon2';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dbDir = resolve(process.env.DEMO_DB ?? join(root, '.demo-data', 'db'));
// Mesmos parâmetros de apps/api/src/modules/auth/crypto.ts (Argon2id, OWASP).
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

if (!existsSync(join(dbDir, 'PG_VERSION'))) {
  console.error(`Banco não encontrado em: ${dbDir}`);
  process.exit(1);
}

const [command, email, password] = process.argv.slice(2);
const db = new PGlite(dbDir);

try {
  if (!command) {
    const { rows } = await db.query(
      `select name, email, role, is_active, last_login_at
         from users order by (role = 'ADMIN') desc, created_at`,
    );
    console.log(`\nBanco: ${dbDir}\n`);
    if (rows.length === 0) console.log('Nenhum usuário cadastrado.');
    for (const u of rows) {
      const last = u.last_login_at ? new Date(u.last_login_at).toLocaleString('pt-BR') : 'nunca';
      console.log(
        `${u.role.padEnd(6)}  ${u.email}  (${u.name})${u.is_active ? '' : '  [INATIVO]'}  — último login: ${last}`,
      );
    }
  } else if (command === 'redefinir' && email && password) {
    // Mesma regra de packages/contracts (passwordSchema).
    if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      throw new Error('A senha deve ter pelo menos 10 caracteres, com letras e números.');
    }
    const passwordHash = await hash(password, ARGON_OPTIONS);
    const { rows } = await db.query(
      `update users set password_hash = $1, is_active = true, updated_at = now()
        where lower(email) = lower($2) returning id, email, role`,
      [passwordHash, email],
    );
    if (rows.length === 0) throw new Error(`Usuário não encontrado: ${email}`);
    // Encerra sessões antigas do usuário.
    await db.query(`update refresh_tokens set revoked_at = now() where user_id = $1 and revoked_at is null`, [rows[0].id]);
    console.log(`Senha redefinida para ${rows[0].email} (${rows[0].role}).`);
  } else {
    console.log('Uso: node scripts/usuarios.mjs [redefinir <email> <nova-senha>]');
  }
} catch (err) {
  console.error('Erro:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.close();
}
