# Regras matemáticas do ProjectionEngine

Implementação: `packages/engine`. Testes: `packages/engine/test` (53 casos).
O motor é **puro e determinístico**: mesma entrada → mesma saída, sem I/O, sem dependência de React, API, banco ou Hostinger.

## 1. Representação numérica

| Grandeza            | Tipo no motor                       | Escala                   | Banco           | JSON                   |
| ------------------- | ----------------------------------- | ------------------------ | --------------- | ---------------------- |
| Percentual (fração) | `Decimal` (decimal.js, precisão 40) | 8 casas (≡ 6 casas em %) | `NUMERIC(12,8)` | string `"0.01475436"`  |
| Dinheiro            | `Decimal`                           | 2 casas                  | `NUMERIC(18,2)` | string `"29254015.86"` |

- `0.10` significa **10%** (igual ao Excel).
- Arredondamento: **HALF_EVEN** (bancário) em toda operação de arredondamento.
- Nunca se usa `number`/`float` para calcular. O driver `pg` é configurado para devolver `NUMERIC` como string.

## 2. Cronograma

- Período 1 = mês (competência) da data de início; a obra ocupa `duração` meses consecutivos.
- `término = último dia do mês (início + duração − 1)`.
- Exemplos: `2027-01-01 + 24 → 2028-12-31`; `2027-03-15 + 1 → 2027-03-31`; `2027-12-01 + 3 → 2028-02-29`.
- Duração: inteiro de 1 a 600. Datas inexistentes (ex.: 30/02) são rejeitadas.
- Rótulos: `JAN/27`, `FEV/27`… (pt-BR).

## 3. Validação de curvas

| Regra                                       | Código                          |
| ------------------------------------------- | ------------------------------- |
| Pelo menos 1 período, no máximo 600         | `CURVE_EMPTY`, `CURVE_TOO_LONG` |
| Períodos sequenciais 1..n                   | `CURVE_PERIOD_SEQUENCE`         |
| R3 — % mensal ≥ 0                           | `CURVE_NEGATIVE_MONTHLY`        |
| R1 — acumulado não diminui                  | `CURVE_CUMULATIVE_DECREASING`   |
| Acumulado ≤ 100%                            | `CURVE_CUMULATIVE_ABOVE_100`    |
| R4 — Σ mensal = 100% (tolerância 1e-8)      | `CURVE_SUM_NOT_100`             |
| R2 — acumulado final = 100%                 | `CURVE_FINAL_NOT_100`           |
| Acumulado informado coerente com os mensais | `CURVE_CUMULATIVE_MISMATCH`     |

**Forma canônica** (o que é gravado): mensais com 8 casas distribuídos por maior resto para que a soma seja exatamente `1.00000000`; acumulado derivado. Ruído de float do Excel (`0.0199999999999`) vira `0.02000000`.

**Normalizar** (ação da tela): escala pesos arbitrários (ex.: 3 × 33,3333%) para somar 100%.

R5 — **Curvas são versionadas e imutáveis**: alterar pontos cria a versão N+1. Obras referenciam uma `curve_version` específica e nunca mudam retroativamente.

## 4. Reamostragem (curva com n pontos, obra com D meses)

A curva é tratada como função acumulada contínua `F(t)`, `t ∈ [0,1]`, linear entre os pontos (`F(i/n) = acumulado_i`, `F(0) = 0`).

```
%mês_k = F(k/D) − F((k−1)/D)        k = 1..D
```

- `n = D` → a curva é reproduzida exatamente.
- Curva plana de 4 pontos em 8 meses → 12,5% por mês.
- A soma é sempre 100% (verificado para D = 1, 7, 13, 24, 36, 60).

## 5. Distribuição com fechamento exato (maior resto / Hamilton)

Para repartir um total `T` (1 ou a taxa em R$) proporcionalmente a pesos `w`:

1. `unidades_exatas_i = T/unidade × w_i / Σw` (unidade = 10⁻⁸ ou 0,01)
2. `piso_i = floor(unidades_exatas_i)`
3. As unidades que faltam vão, uma a uma, para os maiores restos; empate → menor índice.

Garante: **Σ parcelas = T exatamente**, centavo a centavo, de forma determinística.
Ex.: R$ 100,00 em 3 → 33,34 · 33,33 · 33,33.

## 6. Série física (Avanço físico)

`original_k` = distribuição (5) dos pesos reamostrados (4) com total 1.

## 7. Série financeira (Taxa)

```
taxaTotal = round2(orçamento × taxa%)
horizonte  = D + defasagem
peso_{k+defasagem} = %físico_k       (meses 1..defasagem têm peso 0)
taxa_k     = distribuição (5) de taxaTotal pelos pesos
```

Ex.: orçamento 44.187.790,05 × 9% = 3.976.901,1045 → **3.976.901,10**; mês com 0,4% → 15.907,60.

A defasagem (`feeLagMonths`, 0–36) é configurável por obra — na planilha, a receita costuma começar 1–3 meses após o avanço.

## 8. Ajustes manuais e recálculo

Cada célula guarda `original` (curva pura), `current` (valor vigente) e `origin` (`CURVE` | `MANUAL`).

| Modo              | Comportamento                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REPLACE_MANUAL`  | Descarta ajustes; tudo volta à curva.                                                                                                                             |
| `PRESERVE_MANUAL` | Mantém células manuais; o saldo `total − Σmanuais` é redistribuído nas células de curva **proporcionalmente aos pesos da curva** (total segue 100% / taxa total). |

- Σ manuais > total → erro `MANUAL_EXCEEDS_TOTAL` (nada é salvo).
- Todas as células manuais e soma ≠ total → aviso `SERIES_TOTAL_MISMATCH`.
- Ajuste no % físico propaga para a taxa (taxa deriva do físico vigente), exceto meses de taxa ajustados manualmente.
- Ajuste fora do cronograma, duplicado ou negativo → erro.
- Se a duração da obra diminuir, ajustes que caem fora do novo cronograma são descartados no recálculo e registrados (`droppedManualCells`).

Fluxo na aplicação: alterar parâmetros de cálculo de uma obra **sem** ajustes manuais regenera a projeção automaticamente; **com** ajustes, a projeção fica marcada como desatualizada e o usuário escolhe entre preservar ou substituir (nunca há sobrescrita silenciosa).

## 9. Versionamento da projeção

Toda geração, recálculo ou lote de edições cria uma nova versão imutável (`projections.version`), com snapshot dos parâmetros (orçamento, taxa, defasagem, datas, versão da curva, modo, versão do motor). Leituras reconstroem o resultado a partir dos valores gravados (`hydrateProjection`), sem recalcular — uma versão antiga permanece exatamente como foi calculada.

## 10. KPIs e carteira

- **KPIs** (data de referência, padrão = mês atual em America/Sao_Paulo): taxa projetada, realizada (meses ≤ referência), a receber, % físico projetado e acumulado, meses decorridos/duração, término.
- **Carteira** (`aggregatePortfolio`): eixo mensal contínuo cobrindo todas as obras, taxa total por mês, acumulado no ano (reinicia em janeiro, como na planilha) e quantidade de obras ativas no mês.

## 11. Curva em vigor de cada obra (paramétrica × própria)

Regra única (`resolveEffectiveCurve`), usada pela projeção, pelo Consolidado e pela aba “Curvas das obras”:

| Situação na data de referência         | Curva usada                                                           | Status                    |
| -------------------------------------- | --------------------------------------------------------------------- | ------------------------- |
| Mês de início **depois** da referência | Paramétrica (mesmo que já exista curva própria)                       | `NOT_STARTED`             |
| Obra iniciada **com** curva própria    | Própria — com o **seu** mês de início e a **sua** quantidade de meses | `STARTED_ACTUAL`          |
| Obra iniciada **sem** curva própria    | Paramétrica, com aviso `ACTUAL_CURVE_MISSING`                         | `STARTED_AWAITING_ACTUAL` |

- “Iniciada” = mês de início ≤ mês de referência (competência).
- A curva própria chega por `PUT /api/v1/works/:id/actual-curve` (usuário EDITOR ou sistema com `X-Api-Key`). Cada envio cria uma **nova versão imutável** (`work_actual_curves`), validada pelas mesmas regras das curvas paramétricas (§2). `normalize: true` reescala valores com ruído de arredondamento para somar 100%.
- A curva própria **não é reamostrada**: a projeção passa a ter `duração = nº de pontos` e início = `startMonth` da curva (término projetado ≠ término contratual quando há atraso/replanejamento). A taxa total não muda — só sua distribuição no tempo.
- Ao receber uma curva de obra iniciada: sem ajustes manuais → nova versão da projeção (`curveSource = WORK_ACTUAL`); com ajustes → projeção marcada como desatualizada e o usuário escolhe preservar/substituir. Ajustes manuais são **ancorados ao mês**, então continuam no mesmo mês mesmo se o início mudar.
- `needsRecalc`: a projeção atual foi gerada com outra curva que a em vigor hoje (ex.: a obra acabou de iniciar e a curva própria já tinha chegado). `POST /work-curves/sync` regulariza todas (pode ser agendado no cron da VPS).
- A série exibida em “Curvas das obras” (`buildCurveSeries`) é idêntica ao `original` físico do motor (mesma reamostragem + maior resto).

Exemplo de envio por um sistema externo:

```http
PUT /api/v1/works/{id}/actual-curve
X-Api-Key: <chave>
Content-Type: application/json

{ "source": "PLANEJAMENTO", "externalRef": "OBRA-123",
  "months": [ { "month": "2025-09", "monthlyPct": "0.003" }, { "month": "2025-10", "monthlyPct": "0.008" } ] }
```

Meses devem ser contíguos e únicos (`CURVE_MONTH_GAP`, `CURVE_MONTH_DUPLICATED`). Alternativa: `startMonth` + `points: [{ period, monthlyPct }]`.

## 12. Consolidado (equivalente à aba “Painel (2)”)

`buildConsolidatedPanel(projeções, referência)` sobre as projeções **correntes** de todas as obras (não arquivadas):

- Por mês: taxa total (“Mês”), acumulado no ano (reinicia em janeiro), obras com avanço > 0 (“Qtd Obras”).
- Por ano: “Acumulado AAAA” = Σ taxa do ano.
- Por obra e no total: **Recebida** = Σ taxa com mês ≤ referência; **A receber** = Σ taxa depois; Recebida + A receber = Taxa prevista (centavo a centavo); avanço físico acumulado na referência.

## 13. Importação do SharePoint (aba “BD_Infos Gerais”)

Fonte: `Consolidado Físico - Obras.xlsx` (SharePoint · 06 - API), lido pelo Microsoft Graph (`usedRange`). Só a aba **BD_Infos Gerais** é usada; `BD_Físico por atividade` e `BD_Orc` (orçamento, ainda não validado) são ignoradas.

| Coluna da planilha                      | Uso                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `Nome da Obra`                          | Casa com o **nome da obra cadastrado** (padrão da empresa)                 |
| `Mês do Fechamento`                     | Competência (data serial do Excel ou texto dia 1)                          |
| `Replanejado Atual Acumulado - Obra`    | **Curva acumulada da obra** (decisão: “a realidade é o replanejado atual”) |
| `Nº Obra UAU` / `Cliente`               | Referência externa / informativo                                           |
| `Realizado Acumulado`                   | Consolidado → “Avanço ac./mês” (§14)                                       |
| `Replanejado Atual Acumulado - Cliente` | Consolidado → “Status cliente” (§14)                                       |
| `Meta Acumulada - Atual`                | Consolidado → “Status cliente” (§14)                                       |

Regras (`curveFromCumulativeSeries`):

1. Nomes comparados sem diferença de maiúsculas, acentos e espaços repetidos. Obra da planilha sem cadastro → listada em “sem cadastro”; nada é criado automaticamente.
2. Meses ordenados; mês repetido com valores diferentes → rejeita a obra; mês faltante repete o acumulado anterior (0% no mês).
3. Meses iniciais em 0% e meses finais após atingir o valor final são descartados: a curva começa no 1º mês com avanço (esse vira o início efetivo).
4. Acumulado não pode diminuir e deve terminar em 100% ± 0,5 p.p. (dentro da tolerância, a curva é normalizada para 100% exato pelo maior resto; fora, a obra é rejeitada com `CUMULATIVE_NOT_100`).
5. Mensal = acumulado(mês) − acumulado(mês anterior), em Decimal (sem ponto flutuante).
6. Curva idêntica à versão atual → “sem alteração” (não cria versão). Diferente → nova versão (`source = BD_FISICO_GERAL`) e aplicação conforme §11.
7. Cada obra é importada em transação própria: um erro não bloqueia as demais. `dryRun` só simula.

8. As três colunas do Consolidado são opcionais: se faltarem na planilha, a simulação avisa (“Coluna X não encontrada”) e a curva é importada normalmente. Valores são lidos mesmo em meses sem acumulado da obra. Indicadores idênticos aos gravados → “sem alteração” (não gera auditoria).

## 14. Colunas do Consolidado (“Painel de obras”)

Cálculo em `packages/engine/src/work-indicators.ts`; a tela só formata. Mês de referência = seletor “Referência” (padrão: mês atual).

| Coluna                               | Regra                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cliente / Obra / Orçamento raso / UH | Cadastro da obra.                                                                                                                                                                                                              |
| Início de obra                       | 1º mês com avanço > 0 na curva da projeção vigente. Obra com curva própria (API) → início da curva própria; sem curva própria → início da projeção paramétrica (marcado com `*`).                                              |
| Meses incorridos                     | Meses do início até a referência, inclusive (0 antes do início), limitado à duração da curva.                                                                                                                                  |
| Término projetado / duração          | 1º mês em que o acumulado físico atinge 100% (tolerância 1e-8); duração = meses do início ao término, inclusive.                                                                                                               |
| Avanço ac. / mês                     | “Realizado Acumulado” do último mês ≤ referência. Mês = acumulado desse mês − acumulado do mês anterior; se não houver o mês anterior, só é calculado quando o mês é o início da obra (senão “—”).                             |
| Status cliente                       | No último mês ≤ referência que tenha os dois valores: **Atrasada** se `Replanejado Atual Acumulado - Cliente` < `Meta Acumulada - Atual` (8 casas); senão **OK**. Desvio = replanejado − meta (p.p.). Sem dados → “Sem dados”. |
| Taxa mês                             | Taxa da projeção vigente no mês de referência (orçamento × %taxa × curva, com defasagem e ajustes).                                                                                                                            |
| Taxa a receber                       | Σ taxa após o mês de referência.                                                                                                                                                                                               |
| Ajuste projeção taxa                 | Valor informado pelo usuário (§15).                                                                                                                                                                                            |

## 15. Ajuste projeção de taxa (recalibração)

O usuário informa o **novo total de taxa a receber depois do mês de referência** (`remainingTotal`, R$ 2 casas, ≥ 0).

1. `fromMonth` = referência + 1 mês. Meses anteriores a `fromMonth` não mudam.
2. A partir de `fromMonth`, a taxa é redistribuída proporcionalmente ao avanço físico (com a defasagem) desses meses, pelo maior resto: Σ(taxa ≥ fromMonth) = `remainingTotal` exatamente. Sem peso nesses meses → distribuição igual (aviso).
3. Ajustes manuais de taxa dentro da janela são preservados e consomem parte do valor; se passarem do valor → rejeita (`FEE_RECALIBRATION_BELOW_MANUAL`). Sem meses de taxa após a referência → rejeita (`FEE_RECALIBRATION_OUT_OF_RANGE`).
4. Taxa total esperada passa a ser Σ(meses < fromMonth) + `remainingTotal` (a verificação “taxa ≠ orçamento × taxa” deixa de valer para essa versão).
5. O ajuste é guardado em `fee_recalibrations` (histórico, 1 vigente por obra) e é **reaplicado automaticamente** em qualquer recálculo posterior (nova curva, edição de célula, alteração da obra) — `parameters.feeRecalibration` registra qual ajuste gerou cada versão.
6. Células recalibradas mantêm `origin = CURVE`; `original` guarda o valor da curva sem ajuste (rastreabilidade).
7. Remover o ajuste gera nova versão com a taxa voltando a orçamento × %taxa. Toda gravação/remoção entra no histórico (`FEE_RECALIBRATION`, `FEE_RECALIBRATION_CLEARED`).
