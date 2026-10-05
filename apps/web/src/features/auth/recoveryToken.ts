/**
 * Token of the "reset password" link: `?token=` (local mode) or, in Supabase mode, the
 * `#access_token=…&type=recovery|invite` fragment added by Supabase Auth to the redirect URL.
 */
export interface RecoveryLink {
  token: string;
  /** `invite` = first access of a user invited in Supabase → Authentication. */
  kind: 'recovery' | 'invite';
  error: string | null;
}

export function readRecoveryLink(search: string, hash: string): RecoveryLink {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const error = fragment.get('error_description') ?? query.get('error_description');
  const token = query.get('token') ?? fragment.get('access_token') ?? '';
  const type = fragment.get('type');
  return { token, kind: type === 'invite' ? 'invite' : 'recovery', error };
}
