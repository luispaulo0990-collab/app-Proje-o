import { describe, expect, it } from 'vitest';
import { GraphClient } from '../src/integrations/microsoft-graph/graph-client.js';
import { loadEnv } from '../src/config/env.js';

type Call = { url: string; body: URLSearchParams };

function fakeFetch(acceptAssertion: boolean, calls: Call[]): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    if (url.includes('login.microsoftonline.com')) {
      const body = new URLSearchParams(String(init?.body));
      calls.push({ url, body });
      const ok = body.has('client_assertion') ? acceptAssertion : body.get('client_secret') === 's';
      return ok
        ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 })
        : new Response(
            JSON.stringify({
              error_description: 'AADSTS70021: No matching federated identity record found',
            }),
            { status: 400 },
          );
    }
    return new Response(JSON.stringify({ values: [['ok']] }), { status: 200 });
  }) as typeof fetch;
}

describe('Microsoft Graph — credencial federada (Vercel OIDC)', () => {
  it('usa o token da Vercel como client_assertion, sem segredo', async () => {
    const calls: Call[] = [];
    const client = new GraphClient(
      { tenantId: 't', clientId: 'c', clientSecret: null, federatedAssertion: () => 'vercel-jwt' },
      fakeFetch(true, calls),
    );
    expect(await client.worksheetValues('d', 'i', 'Aba')).toEqual([['ok']]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.get('client_assertion')).toBe('vercel-jwt');
    expect(calls[0]?.body.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    expect(calls[0]?.body.has('client_secret')).toBe(false);
    expect(client.lastMethod).toBe('federated');
  });

  it('cai para o segredo enquanto a credencial federada não existe no Entra', async () => {
    const calls: Call[] = [];
    const client = new GraphClient(
      { tenantId: 't', clientId: 'c', clientSecret: 's', federatedAssertion: () => 'vercel-jwt' },
      fakeFetch(false, calls),
    );
    await client.worksheetValues('d', 'i', 'Aba');
    expect(calls.map((c) => (c.body.has('client_assertion') ? 'oidc' : 'secret'))).toEqual([
      'oidc',
      'secret',
    ]);
    expect(client.lastMethod).toBe('secret');
  });

  it('sem segredo e sem federação, mostra o erro da Microsoft', async () => {
    const client = new GraphClient(
      { tenantId: 't', clientId: 'c', clientSecret: null, federatedAssertion: () => 'x' },
      fakeFetch(false, []),
    );
    await expect(client.worksheetValues('d', 'i', 'Aba')).rejects.toThrow(/AADSTS70021/);
  });

  it('na Vercel a integração fica ativa mesmo sem MS_GRAPH_CLIENT_SECRET', () => {
    const base = {
      DATABASE_URL: 'pglite:memory',
      AUTH_SECRET: 'x'.repeat(40),
      MS_GRAPH_TENANT_ID: 't',
      MS_GRAPH_CLIENT_ID: 'c',
      MS_GRAPH_DRIVE_ID: 'd',
      MS_GRAPH_ITEM_ID: 'i',
    };
    expect(loadEnv(base).graph).toBeNull();
    expect(loadEnv({ ...base, VERCEL: '1' }).graph?.clientSecret).toBeNull();
  });
});
