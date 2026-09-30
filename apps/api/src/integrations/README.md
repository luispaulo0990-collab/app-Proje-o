# Integration Layer

Ponto único para integrações externas futuras (Excel, Power BI, SharePoint/Microsoft Graph, ERP).

Regras:

- Adaptadores aqui **consomem** serviços de aplicação / o `@unita/engine`; nunca o contrário.
- O domínio (`packages/engine`) não importa nada desta pasta.
- Cada integração expõe uma interface (porta) e uma implementação (adaptador), ex.:
  `ProjectionExporter` → `CsvProjectionExporter`, `XlsxProjectionExporter`.
- Formatos de troca usam os mesmos contratos de `@unita/contracts` (decimais como string).

## Curvas próprias das obras (entrada)

Contrato genérico já disponível: `PUT /api/v1/works/:id/actual-curve` com `X-Api-Key`
(ver `docs/CALCULATION_RULES.md` §11). Adaptador de **pull** implementado: `microsoft-graph/` (porta `WorkCurveProvider` em
`work-curve-provider.ts`) lê a aba `BD_Infos Gerais` e alimenta `curve-sync.service.ts`, que
reusa `importActualCurve`. Nova fonte = novo adaptador da mesma porta.

| Arquivo                                        | Papel                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| `microsoft-graph/graph-client.ts`              | Token client-credentials + `usedRange` (sem SDK) |
| `microsoft-graph/sheet-values.ts`              | Datas seriais do Excel, frações pt-BR            |
| `microsoft-graph/fisico-geral.parser.ts`       | Cabeçalho → séries acumuladas por obra           |
| `microsoft-graph/graph-work-curve-provider.ts` | Adaptador + construção a partir do `.env`        |
| `sync-work-curves.ts`                          | CLI para cron                                    |
