import { sql } from 'drizzle-orm';
import type { Db } from './client.js';
import { queryRows } from './raw-query.js';

/**
 * Supabase → Authentication is where users are created. This keeps `public.users` (profile +
 * role used by the app) in step with `auth.users`:
 *
 * - new Auth user  → linked to the existing profile with the same e-mail, or a new VIEWER profile
 *                    (the admin then sets the role in Table Editor → users → role);
 * - e-mail changed → profile e-mail updated;
 * - Auth user deleted → profile deactivated (history and audit are kept).
 *
 * Idempotent; runs after every migration. No-op when `auth.users` does not exist
 * (plain PostgreSQL / PGlite). Returns false when the triggers could not be installed
 * (the login fallback in auth.service still links/creates profiles on first sign-in).
 */
export async function syncSupabaseAuthUsers(
  db: Db,
  log: (message: string) => void = (m) => console.warn(m),
): Promise<boolean> {
  const [found] = await queryRows<{ present: boolean }>(
    db,
    sql`SELECT to_regclass('auth.users') IS NOT NULL AS present`,
  );
  if (!found?.present) return false;

  await db.execute(sql`
    CREATE OR REPLACE FUNCTION public.unita_sync_auth_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        UPDATE public.users SET is_active = false, auth_user_id = NULL, updated_at = now()
         WHERE auth_user_id = OLD.id;
        RETURN OLD;
      END IF;
      IF NEW.email IS NULL THEN
        RETURN NEW;
      END IF;
      UPDATE public.users SET email = lower(NEW.email), updated_at = now()
       WHERE auth_user_id = NEW.id;
      IF FOUND THEN
        RETURN NEW;
      END IF;
      UPDATE public.users SET auth_user_id = NEW.id, updated_at = now()
       WHERE auth_user_id IS NULL AND lower(email) = lower(NEW.email);
      IF NOT FOUND THEN
        INSERT INTO public.users (name, email, role, auth_user_id)
        VALUES (
          left(coalesce(nullif(trim(NEW.raw_user_meta_data ->> 'name'), ''),
                        nullif(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
                        split_part(NEW.email, '@', 1)), 120),
          lower(NEW.email), 'VIEWER', NEW.id);
      END IF;
      RETURN NEW;
    END $$`);
  await db.execute(sql`REVOKE ALL ON FUNCTION public.unita_sync_auth_user() FROM PUBLIC`);

  try {
    await db.execute(sql`DROP TRIGGER IF EXISTS unita_auth_user_created ON auth.users`);
    await db.execute(sql`DROP TRIGGER IF EXISTS unita_auth_user_email ON auth.users`);
    await db.execute(sql`DROP TRIGGER IF EXISTS unita_auth_user_deleted ON auth.users`);
    await db.execute(sql`CREATE TRIGGER unita_auth_user_created AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.unita_sync_auth_user()`);
    await db.execute(sql`CREATE TRIGGER unita_auth_user_email AFTER UPDATE OF email ON auth.users
      FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
      EXECUTE FUNCTION public.unita_sync_auth_user()`);
    await db.execute(sql`CREATE TRIGGER unita_auth_user_deleted AFTER DELETE ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.unita_sync_auth_user()`);
  } catch (err) {
    log(
      `Aviso: não foi possível criar os gatilhos em auth.users (${err instanceof Error ? err.message : err}). ` +
        'Os usuários do Supabase serão vinculados no primeiro login.',
    );
    return false;
  }

  // Users created in Supabase before the triggers existed.
  await db.execute(sql`
    UPDATE public.users u SET auth_user_id = a.id, updated_at = now()
      FROM auth.users a
     WHERE u.auth_user_id IS NULL AND a.email IS NOT NULL
       AND lower(u.email) = lower(a.email)
       AND NOT EXISTS (SELECT 1 FROM public.users x WHERE x.auth_user_id = a.id)`);
  await db.execute(sql`
    INSERT INTO public.users (name, email, role, auth_user_id)
    SELECT left(coalesce(nullif(trim(a.raw_user_meta_data ->> 'name'), ''),
                         nullif(trim(a.raw_user_meta_data ->> 'full_name'), ''),
                         split_part(a.email, '@', 1)), 120),
           lower(a.email), 'VIEWER', a.id
      FROM auth.users a
     WHERE a.email IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.users u
                        WHERE u.auth_user_id = a.id OR lower(u.email) = lower(a.email))`);
  return true;
}
