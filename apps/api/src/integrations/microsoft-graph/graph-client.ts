/**
 * Minimal Microsoft Graph client (app-only / client credentials). No SDK dependency: two
 * HTTPS calls, token cached until shortly before expiry. `fetch` is injectable for tests.
 */
export interface GraphCredentials {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GraphError';
  }
}

type Fetch = typeof fetch;

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TIMEOUT_MS = 60_000;

export class GraphClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly credentials: GraphCredentials,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const { tenantId, clientId, clientSecret } = this.credentials;
    const res = await this.fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !body.access_token) {
      // Never include the secret; Entra's description is safe to surface.
      throw new GraphError(
        `Falha na autenticação com a Microsoft: ${body.error_description?.split('\r\n')[0] ?? res.status}`,
        res.status,
      );
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max((body.expires_in ?? 3600) - 120, 60) * 1000,
    };
    return this.token.value;
  }

  /** `usedRange(valuesOnly=true)` of a worksheet → raw values matrix. */
  async worksheetValues(driveId: string, itemId: string, sheet: string): Promise<unknown[][]> {
    const sheetRef = encodeURIComponent(sheet.replace(/'/g, "''"));
    const url =
      `${GRAPH}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}` +
      `/workbook/worksheets('${sheetRef}')/usedRange(valuesOnly=true)?$select=values`;
    const res = await this.fetchImpl(url, {
      headers: { authorization: `Bearer ${await this.accessToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) {
      // Login worked (we have a token) but the app has no permission on the file yet.
      this.token = null;
      throw new GraphError(
        `O login na Microsoft funcionou, mas o aplicativo ainda não tem permissão para ler o arquivo ` +
          `(Graph ${res.status}). Falta o consentimento do administrador para Sites.Read.All ` +
          `(ou a liberação do site no Sites.Selected). Depois de concedido, aguarde alguns minutos e clique em Simular de novo.`,
        res.status,
      );
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new GraphError(
        `Microsoft Graph respondeu ${res.status} ao ler a aba "${sheet}": ${body.error?.message ?? res.statusText}`,
        res.status,
      );
    }
    const body = (await res.json()) as { values?: unknown[][] };
    return body.values ?? [];
  }
}
