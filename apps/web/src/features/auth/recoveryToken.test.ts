import { describe, expect, it } from 'vitest';
import { readRecoveryLink } from './recoveryToken';

describe('readRecoveryLink', () => {
  it('lê o token local da query string', () => {
    expect(readRecoveryLink('?token=abc', '')).toEqual({
      token: 'abc',
      kind: 'recovery',
      error: null,
    });
  });

  it('lê o access_token do Supabase no fragmento (recuperação e convite)', () => {
    expect(readRecoveryLink('', '#access_token=jwt&type=recovery&expires_in=3600').token).toBe(
      'jwt',
    );
    expect(readRecoveryLink('', '#access_token=jwt&type=invite').kind).toBe('invite');
  });

  it('expõe o erro de link expirado do Supabase', () => {
    const link = readRecoveryLink(
      '',
      '#error=access_denied&error_description=Email+link+is+invalid+or+has+expired',
    );
    expect(link).toMatchObject({ token: '', error: 'Email link is invalid or has expired' });
  });
});
