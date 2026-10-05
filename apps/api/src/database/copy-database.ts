/**
 * Copia todos os dados de um banco para outro — uso principal: levar o banco da demonstração
 * (PGlite em `.demo-data/db`) para o Supabase, uma única vez.
 *
 *   npm run db:copy                       → origem .demo-data/db, destino DATABASE_MIGRATION_URL
 *   npm run db:copy -- --substituir       → apaga os dados do destino antes de copiar
 *   npm run db:copy -- --origem <url> --destino <url>
 *
 * Os dois bancos são levados à última migration; a cópia é genérica (todas as tabelas do schema
 * `public`, em ordem de chaves estrangeiras) e roda numa única transação no destino. Ao final,
 * cada tabela é conferida linha a linha (hash SHA-256) entre origem e destino.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import {
  createDatabase,
  DUMP_PREFIX,
  EMBEDDED_PREFIX,
  isEmbeddedUrl,
  migrationUrl,
  type Db,
} from './client.js';
import { migrateDatabase } from './migrate.js';
import { syncSupabaseAuthUsers } from './supabase-auth-sync.js';
import { queryRows } from './raw-query.js';

const BATCH_ROWS = 2000;

export interface CopyReport {
  tables: { table: string; rows: number }[];
  totalRows: number;
}

interface TableInfo {
  name: string;
  selfReferencing: boolean;
}

const rows = queryRows;

/** Tables of `public`, parents before children (topological order of foreign keys). */
export async function tablesInDependencyOrder(db: Db): Promise<TableInfo[]> {
  const tables = (
    await rows<{ tablename: string }>(
      db,
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )
  ).map((r) => r.tablename);
  const edges = await rows<{ child: string; parent: string }>(
    db,
    sql`SELECT c.relname AS child, p.relname AS parent
          FROM pg_constraint k
          JOIN pg_class c ON c.oid = k.conrelid
          JOIN pg_class p ON p.oid = k.confrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE k.contype = 'f' AND n.nspname = 'public'`,
  );
  const parents = new Map(tables.map((t) => [t, new Set<string>()]));
  const selfRef = new Set<string>();
  for (const { child, parent } of edges) {
    if (child === parent) selfRef.add(child);
    else parents.get(child)?.add(parent);
  }
  const ordered: string[] = [];
  const done = new Set<string>();
  while (ordered.length < tables.length) {
    const ready = tables.filter(
      (t) => !done.has(t) && [...(parents.get(t) ?? [])].every((p) => done.has(p)),
    );
    if (ready.length === 0) throw new Error('Ciclo de chaves estrangeiras entre tabelas.');
    for (const t of ready) {
      done.add(t);
      ordered.push(t);
    }
  }
  return ordered.map((name) => ({ name, selfReferencing: selfRef.has(name) }));
}

async function countRows(db: Db, table: string): Promise<number> {
  const [r] = await rows<{ n: string | number }>(
    db,
    sql`SELECT count(*)::int AS n FROM public.${sql.identifier(table)}`,
  );
  return Number(r?.n ?? 0);
}

/** Order-independent SHA-256 of a table's rows (JSON text, UTC timestamps). */
async function tableHash(db: Db, table: string): Promise<string> {
  const data = await rows<{ r: string }>(
    db,
    sql`SELECT row_to_json(t)::text AS r FROM public.${sql.identifier(table)} t`,
  );
  const hash = createHash('sha256');
  for (const line of data.map((d) => d.r).sort()) hash.update(line).update('\n');
  return hash.digest('hex');
}

async function readBatch(db: Db, table: TableInfo, offset: number, limit: number) {
  const id = sql.identifier(table.name);
  const [r] = await rows<{ data: string | null }>(
    db,
    sql`SELECT json_agg(t)::text AS data
          FROM (SELECT * FROM public.${id} ORDER BY ctid OFFSET ${offset} LIMIT ${limit}) t`,
  );
  return r?.data ?? null;
}

async function resetSequences(db: Db): Promise<void> {
  const serials = await rows<{ table_name: string; column_name: string }>(
    db,
    sql`SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public'
           AND (column_default LIKE 'nextval(%' OR is_identity = 'YES')`,
  );
  for (const { table_name, column_name } of serials) {
    const table = sql.identifier(table_name);
    const column = sql.identifier(column_name);
    await db.execute(
      sql`SELECT setval(pg_get_serial_sequence(${`public."${table_name}"`}, ${column_name}),
                        COALESCE((SELECT max(${column}) FROM public.${table}), 0) + 1, false)`,
    );
  }
}

export async function copyDatabase(
  source: Db,
  target: Db,
  options: { replace?: boolean; log?: (m: string) => void } = {},
): Promise<CopyReport> {
  const log = options.log ?? ((m: string) => console.warn(m));
  await source.execute(sql`SET TIME ZONE 'UTC'`);
  await target.execute(sql`SET TIME ZONE 'UTC'`);

  const tables = await tablesInDependencyOrder(source);
  const targetTables = new Set((await tablesInDependencyOrder(target)).map((t) => t.name));
  const missing = tables.filter((t) => !targetTables.has(t.name)).map((t) => t.name);
  if (missing.length) {
    throw new Error(`Tabelas ausentes no destino (migrations diferentes?): ${missing.join(', ')}`);
  }

  // Profiles auto-created from Supabase Auth (VIEWER, no local password) are not "real" data.
  const [real] = await rows<{ n: number }>(
    target,
    sql`SELECT count(*)::int AS n FROM public.users
         WHERE NOT (password_hash IS NULL AND auth_user_id IS NOT NULL AND role = 'VIEWER')`,
  );
  const targetUsers = Number(real?.n ?? 0);
  if (targetUsers > 0 && !options.replace) {
    throw new Error(
      `O destino já tem ${targetUsers} usuário(s) cadastrado(s). Para apagar os dados do destino e copiar mesmo assim, rode de novo com --substituir.`,
    );
  }

  const report: CopyReport = { tables: [], totalRows: 0 };
  await target.transaction(async (tx) => {
    // Seed-only data (standard curves, INCC history) is replaced by the source's copy.
    const all = sql.join(
      tables.map((t) => sql`public.${sql.identifier(t.name)}`),
      sql`, `,
    );
    await tx.execute(sql`TRUNCATE ${all} RESTART IDENTITY CASCADE`);

    for (const table of tables) {
      const total = await countRows(source, table.name);
      const step = table.selfReferencing ? Math.max(total, 1) : BATCH_ROWS;
      const id = sql.identifier(table.name);
      for (let offset = 0; offset < total; offset += step) {
        const data = await readBatch(source, table, offset, step);
        if (!data) continue;
        await tx.execute(
          sql`INSERT INTO public.${id} OVERRIDING SYSTEM VALUE
              SELECT * FROM json_populate_recordset(NULL::public.${id}, ${data}::json)`,
        );
      }
      report.tables.push({ table: table.name, rows: total });
      report.totalRows += total;
      log(`  ${table.name.padEnd(28)} ${String(total).padStart(7)} linhas`);
    }
    await resetSequences(tx);
  });

  log('Conferindo origem × destino…');
  for (const { table } of report.tables) {
    const [a, b] = await Promise.all([tableHash(source, table), tableHash(target, table)]);
    if (a !== b) throw new Error(`Conferência falhou na tabela ${table}: conteúdo diferente.`);
  }
  return report;
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function describe(url: string): string {
  if (isEmbeddedUrl(url)) return `banco local ${url.slice(EMBEDDED_PREFIX.length)}`;
  const u = new URL(url);
  return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const demoDb = join(repoRoot, '.demo-data', 'db');
  // Backup recovered from a damaged demo database (when present) takes precedence.
  const recovered = join(repoRoot, '.demo-data', 'recuperado.tar.gz');
  const from =
    argValue(args, '--origem') ??
    (existsSync(recovered)
      ? `${EMBEDDED_PREFIX}${DUMP_PREFIX}${recovered}`
      : `${EMBEDDED_PREFIX}${demoDb}`);
  const to = argValue(args, '--destino') ?? migrationUrl();
  if (!to || isEmbeddedUrl(to)) {
    throw new Error(
      'Destino não definido: preencha DATABASE_MIGRATION_URL (ou DATABASE_URL) no arquivo .env com a conexão do Supabase.',
    );
  }
  const sourcePath = from.slice(EMBEDDED_PREFIX.length).replace(DUMP_PREFIX, '');
  if (isEmbeddedUrl(from) && !existsSync(sourcePath)) {
    throw new Error(`Banco de origem não encontrado em ${sourcePath}.`);
  }

  console.warn(`Origem:  ${describe(from)}\nDestino: ${describe(to)}\n`);
  const source = createDatabase(from, 1);
  const target = createDatabase(to, 1);
  try {
    console.warn('Aplicando migrations na origem e no destino…');
    await migrateDatabase(source);
    await migrateDatabase(target);
    console.warn('Copiando…');
    const report = await copyDatabase(source, target, { replace: args.includes('--substituir') });
    // Re-link the copied profiles to the users already created in Supabase → Authentication.
    await syncSupabaseAuthUsers(target);
    console.warn(
      `\nConcluído: ${report.totalRows} linhas em ${report.tables.length} tabelas, conferidas uma a uma.`,
    );
  } finally {
    await source.close();
    await target.close();
  }
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error('\nFalha na cópia:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
