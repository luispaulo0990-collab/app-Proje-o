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
horizonte  = D + 1
peso_{k+1} = %físico_k       (o 1º mês tem peso 0)
taxa_k     = distribuição (5) de taxaTotal pelos pesos
```

Ex.: orçamento 44.187.790,05 × 9% = 3.976.901,1045 → **3.976.901,10**; mês com 0,4% → 15.907,60.

**Competência M−1** (regra fixa para todas as obras, decidida em 01/10/2026): a taxa emitida em um mês se refere ao avanço físico medido no mês anterior — recebe-se em outubro o que foi medido em setembro (`FEE_COMPETENCE_LAG_MONTHS = 1`). A antiga defasagem configurável por obra (`feeLagMonths`) deixou de existir.

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

Toda geração, recálculo ou lote de edições cria uma nova versão imutável (`projections.version`), com snapshot dos parâmetros (orçamento, taxa, competência, emissões/INCC aplicados, datas, versão da curva, modo, versão do motor). Leituras reconstroem o resultado a partir dos valores gravados (`hydrateProjection`), sem recalcular — uma versão antiga permanece exatamente como foi calculada.

## 10. KPIs e carteira

- **KPIs** (data de referência, padrão = mês atual em America/Sao_Paulo): taxa projetada, realizada (meses ≤ referência), a receber, % físico projetado e acumulado, meses decorridos/duração, término.
- **Carteira** (`aggregatePortfolio`): eixo mensal contínuo cobrindo todas as obras, taxa total por mês, acumulado no ano (reinicia em janeiro, como na planilha) e quantidade de obras ativas no mês.

## 11. Curva em vigor de cada obra (paramétrica × própria)

Regra única (`resolveEffectiveCurve`), usada pela projeção, pelo Consolidado e pela aba “Curvas das obras”:

| Situação na data de referência         | Curva usada                                                                                                                 | Status                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Mês de início **depois** da referência | Paramétrica (mesmo que já exista curva própria)                                                                             | `NOT_STARTED`             |
| Obra iniciada **com** curva própria    | Própria — com o **seu** mês de início e a **sua** quantidade de meses; com Realizado Acumulado, realizado + tendência (§18) | `STARTED_ACTUAL`          |
| Obra iniciada **sem** curva própria    | Paramétrica, com aviso `ACTUAL_CURVE_MISSING`                                                                               | `STARTED_AWAITING_ACTUAL` |

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
| Taxa mês                             | Taxa do mês de referência: valor emitido, se houver; senão a projeção (§7 e §15).                                                                                                                                              |
| Taxa a receber                       | Σ taxa após o mês de referência.                                                                                                                                                                                               |
| Taxa emitida no mês                  | Valor faturado no mês de referência, informado pelo usuário ou por integração (§15).                                                                                                                                           |

## 15. Taxa emitida e correção pelo INCC

Substitui o antigo “Ajuste projeção de taxa” (recalibração pelo saldo). Cálculo em `packages/engine/src/fee-schedule.ts` (`buildFeeSchedule`).

**Entradas**

- **Taxa emitida** (`fee_issuances`, por obra e mês, R$ 2 casas, ≥ 0): valor faturado no mês. Pela competência M−1 (§7), refere-se ao avanço do mês anterior.
- **INCC mensal** (`incc_indices`, global): desde 02/10/2026 o cadastro é o **número-índice do mês** (ex.: INCC-DI de AGO/26 = 1.296,889; 6 casas). O motor deriva a variação: `INCC(M) = round8(índice(M) ÷ índice(M−1) − 1)` (HALF_EVEN, `inccRatesFromIndices`); sem índice de M−1 não há variação em M (1º mês do histórico ou lacuna). **O INCC do mês M−1 corrige o saldo a receber em M** (o INCC de setembro corrige outubro). Histórico carregado: INCC-DI (FGV), AGO/1994 → AGO/2026 (385 meses, `INCC-DI.xlsx` aba Plan1), inserido só nos meses ainda não cadastrados.

**Regra** — sem nenhuma emissão, a taxa segue a §7 (orçamento × %taxa pela curva) e o INCC não é aplicado. Com emissões, sendo A o primeiro e L o último mês com emissão:

1. Meses antes de A mantêm a distribuição normal da curva. `saldo = taxa total − Σ(meses antes de A)`.
2. Para cada mês M de A até L, em ordem: `saldo = round2(saldo × (1 + INCC(M−1)))` (HALF_EVEN; só sobre saldo positivo e só se o INCC de M−1 estiver cadastrado); `taxa(M) = valor emitido em M` — mês sem emissão dentro dessa janela foi faturado em **0** —; `saldo −= taxa(M)`.
3. INCC já publicado para os meses logo após L (sequência contínua de meses cadastrados) também corrige o saldo antes da projeção.
4. O saldo é projetado nos meses depois de L pelo avanço físico (competência M−1), pelo maior resto, preservando ajustes manuais de taxa: Σ(taxa após L) = saldo exatamente.
5. **Taxa prevista** = taxa contratual + Σ correções do INCC. Recebida + A receber = Taxa prevista, centavo a centavo.

Ex.: taxa 100.000,00, curva 4 × 25%. INCC de JAN = 1%, emissão de FEV = 25.000,00 → em FEV: 100.000 × 1,01 = 101.000 − 25.000 = **76.000** a receber, projetados em MAR/ABR/MAI (25.333,34 · 25.333,33 · 25.333,33).

**Avisos e rejeições**

| Código                      | Situação                                                                        |
| --------------------------- | ------------------------------------------------------------------------------- |
| `FEE_ISSUANCE_OUT_OF_RANGE` | Emissão fora do período de recebimento da obra → rejeita (422, nada é gravado). |
| `INVALID_FEE_ISSUANCE`      | Valor negativo, mais de 2 casas ou mês inválido → rejeita.                      |
| `INVALID_INCC_RATE`         | INCC ≤ −100% ou inválido → rejeita.                                             |
| `FEE_MANUAL_SUPERSEDED`     | Ajuste manual de taxa em mês com emissão: o valor emitido prevalece (aviso).    |
| `FEE_ISSUED_ABOVE_BALANCE`  | Emissões acima da taxa corrigida: nada resta a projetar (aviso).                |
| `FEE_BALANCE_UNALLOCATED`   | Sobrou saldo depois do último mês de recebimento da projeção (aviso).           |

**Rastreabilidade**

- Células emitidas têm `origin = ISSUED` (verde na grade); `original` guarda o valor que a curva daria. Não podem ser editadas na grade da projeção — o valor é alterado na coluna “Taxa emitida no mês” do Consolidado.
- Cada emissão, alteração ou remoção (`FEE_ISSUANCE`, `FEE_ISSUANCE_REMOVED`) gera nova versão da projeção e entra no histórico da obra. Cada INCC salvo, importado em lote ou removido (`INCC_SET`, `INCC_IMPORT`, `INCC_REMOVED`) recalcula todas as obras com emissão, com um registro de recálculo no histórico de cada uma.
- `parameters.feeAdjustment` de cada versão guarda o resumo aplicado: 1º/último mês emitido, total emitido, correção do INCC, saldo após a última emissão e taxa prevista.
- Emissões e INCC podem ser enviados por sistemas externos (`X-Api-Key`): `PUT /works/:id/fee-issuances/:mes`, `PUT /incc-indices/:mes` (ou `PUT /incc-indices` em lote).
- Atualização das versões antigas (motor 0.2.0, com defasagem configurável ou recalibração): ao aplicar as migrations, cada projeção corrente é recalculada uma única vez com as regras atuais, preservando os ajustes manuais e registrando “Atualização das regras de taxa” no histórico. Os ajustes antigos continuam visíveis no histórico.

## 16. IEC Obra (aba “BD_Econômico”)

Definido em 02/10/2026.

- **Fonte:** aba `BD_Econômico` de `Consolidado Físico - Obras.xlsx`, somente a linha cujo **Item = “Geral”** de cada obra e mês (as demais linhas são itens de orçamento). Colunas lidas: `Nome da Obra`, `Mês do Fechamento`, `IEC Obra` e `Resultado Projetado Obra`; `Nome Cliente + Obra` serve para separar obras de mesmo nome.
- **Casamento:** mesmas regras das curvas próprias (nome padrão cadastrado; nome com marca/cliente = APROXIMADO, conferir na simulação).
- **Canonização:** IEC com 6 casas (`1.020000`), resultado em R$ com 2 casas, arredondamento half-even. **IEC = 0 é tratado como “sem IEC”** e um mês com IEC 0 e resultado 0 não é um fechamento (a planilha publica zeros antes do fechamento).
- **Consolidado:** coluna “IEC obra / resultado” mostra o **último fechamento com mês ≤ mês de referência** (`computeEconomicIndicators`, motor): índice em cima, resultado projetado embaixo (vermelho quando negativo). Sem fechamento → “Aguardando API”.
- **Sincronização:** roda junto com “Simular / Importar” das curvas; erro de leitura da aba BD_Econômico vira aviso no relatório e não bloqueia as curvas. Também é aceito pelo endpoint genérico `PUT /works/:id/economic-indicators`.

## 17. Vigências da taxa e periodicidade da correção pelo INCC

Definido em 07/10/2026. Motor 0.4.0 (`packages/engine/src/fee-terms.ts`, `incc.ts`). Os parâmetros de taxa variam muito de cliente para cliente, por isso tudo é configurável **por obra** e **ao longo do tempo**.

**Condições da obra**

- **Cadastro:** taxa (%), periodicidade da correção pelo INCC (padrão mensal) e **mês-base do INCC** (data-base do ciclo; vazio = mês de início planejado).
- **Vigências** (`work_fee_terms`, aba “Taxa e INCC” da obra): a partir de um mês, uma **nova taxa** e uma **nova periodicidade**, válidas até a próxima vigência. Informa-se o **valor novo** (de 8% para 9% → `0.09`), nunca a variação.

**Taxa vigente no mês** — `taxa(M) = %físico(M−1) × orçamento × taxa vigente em M` (M = mês de recebimento, competência M−1).

- Uma única taxa no horizonte → regra original: `round2(orçamento × taxa)` distribuída pela curva.
- Com mudança: cada mês pesa `%físico × taxa vigente`; total = `round2(orçamento × Σ(%físico × taxa) ÷ Σ%físico)`, distribuído pelo maior resto. Meses anteriores à mudança não são alterados.
- Com taxa emitida, a regra da §15 é aplicada sobre esse total e esses pesos: o saldo após a última emissão é projetado já com a taxa de cada mês.
- Ex.: 4 × 25%, orçamento 1.000.000, 10% e vigência de ABR a 8% → 0 · 25.000 · 25.000 · 20.000 · 20.000 (total 90.000).

**Periodicidade da correção** (só a partir da 1ª emissão, como na §15)

| Periodicidade | N   | Meses corrigidos                              |
| ------------- | --- | --------------------------------------------- |
| Mensal        | 1   | todo mês M, pelo INCC de M−1 (regra original) |
| Trimestral    | 3   | data-base + 3, + 6, …                         |
| Quadrimestral | 4   | data-base + 4, + 8, …                         |
| Semestral     | 6   | data-base + 6, + 12, …                        |
| Anual         | 12  | data-base + 12, + 24, …                       |

- A correção usa a **variação acumulada da janela**: `índice(M−1) ÷ índice(mês anterior à janela) − 1` (8 casas, HALF_EVEN). Ex.: data-base JAN, trimestral → ABR é corrigido pela variação de JAN..MAR.
- A janela começa logo depois do último mês de INCC já aplicado: trocar a periodicidade (ou publicar um índice atrasado) nunca conta um mês duas vezes nem pula um mês.
- Correção devida sem o índice publicado → não é aplicada; depois da última emissão a projeção para na primeira correção ainda sem índice (como na §15).

**Avisos e rejeições:** `INVALID_FEE_TERM` (mês, taxa fora de 0–100% ou periodicidade inválida), `FEE_TERM_DUPLICATED`, `INVALID_INCC_PERIODICITY`, `INVALID_INCC_BASE_MONTH`; `FEE_TERM_OUT_OF_RANGE` (aviso: vigência depois do último mês de recebimento).

**Rastreabilidade:** cada vigência salva ou removida gera nova versão da projeção (ajustes manuais preservados) e entra no histórico (`FEE_TERM`, `FEE_TERM_REMOVED`). `parameters` de cada versão guarda `feeTerms`, `inccPeriodicity`, `inccBaseMonth` e `expectedFee`. API: `GET/PUT/DELETE /works/:id/fee-terms[/:mes]` (`{ feeRate, inccPeriodicity, note? }`, JWT EDITOR ou `X-Api-Key`).

## 18. Curva da obra iniciada: realizado + tendência

Definido em 07/10/2026. Motor 0.5.0 (`packages/engine/src/trend-curve.ts`, `buildTrendCurve`). Vale para obras **iniciadas com curva própria** (§11) que já têm **Realizado Acumulado** (§13/§14). Sem realizado, a curva própria (Replanejado Atual Acumulado - Obra) continua sendo usada como chega.

1. **Até o mês atual** a curva é o **Realizado Acumulado** da API (mensal = acumulado do mês − do mês anterior; mês sem dado repete o anterior; queda é ignorada com aviso `REALIZED_DECREASING`). O **mês atual** só entra como realizado se já tiver avanço; senão, ele é o 1º mês da tendência.
2. **Ritmo** = avanço médio mensal realizado nos últimos **3 meses** (`TREND_WINDOW_MONTHS`; menos, se a obra começou há menos tempo).
3. **Tendência** nos meses seguintes: `tendência(M) = 0,6 × replanejado(M) + 0,4 × ritmo` (`TREND_PLAN_WEIGHT = 0,6`). Ex.: ritmo 3% e replanejado pedindo 15% → 0,6 × 15% + 0,4 × 3% = **10,2%**.
4. **O término do replanejado é respeitado** (decisão do usuário, 07/10/2026): o que falta para 100% é distribuído entre o mês seguinte ao último realizado e o último mês do replanejado (`endMonth`), **proporcionalmente** aos valores do item 3 (maior resto, 8 casas). Ex.: realizado 9% (plano previa 15%), ritmo 3%, replanejado 15% × 5 e 10% → pesos 10,2% × 5 e 7,2% (Σ 58,2%) → 91% × 10,2 ÷ 58,2 = **15,95%** nos meses de 15% e **11,26%** no último. A obra atrasada mantém o prazo e absorve o atraso; a tendência só achata a distribuição (menos nos picos do plano, mais nos meses menores). Obra em dia fica praticamente igual ao replanejado.
   - Prazo do replanejado já vencido e obra abaixo de 100% → o saldo vai para o mês seguinte ao último realizado (aviso `TREND_PAST_DEADLINE`).
5. A curva resultante vira a curva física da projeção (taxa, Consolidado, Curvas das obras). Início = o mais cedo entre o início do replanejado e o 1º mês com realizado.

**Recálculo** — cada projeção guarda a impressão digital da curva usada (`curveFingerprint`) e o resumo (`trend`). Chegou realizado novo (`PUT /works/:id/progress-indicators` ou importação do SharePoint) → a projeção é regenerada; com ajustes manuais, fica marcada como desatualizada (§8). A importação diária (cron) termina sincronizando todas as obras, então a virada do mês também é absorvida.

**Tela** — em “Curvas das obras”, os meses de tendência aparecem em _itálico azul_ e a obra mostra “Tendência · ritmo X%/mês”.

## 19. Projeção manual da taxa no Consolidado e recálculo dinâmico

Definido em 07/10/2026.

- **Edição no Consolidado:** na linha “Taxa (R$)” de cada obra, o editor clica no mês e digita o valor projetado (Enter salva, Esc cancela). Grava um ajuste manual de taxa (`PUT /projections/:workId`, `series = FEE`) — mesma regra da §8: os meses digitados são mantidos e o saldo é redistribuído nos demais meses pelos pesos da curva, com fechamento exato. Esvaziar um mês manual o devolve à curva. Meses com taxa emitida não são editáveis ali (use “Taxa emitida no mês”).
- **Vários meses:** cada mês digitado (ex.: o mês que vem e 3 meses à frente) continua manual até ser apagado; só os outros meses são recalculados.
- **Recálculo dinâmico (muda a §8):** qualquer alteração de entrada — cadastro da obra, curva própria/tendência (§11, §18), taxa emitida, INCC, vigências (§17) — gera nova versão **preservando** os ajustes manuais, e todas as telas são atualizadas. A projeção só fica “Revisar ajustes” (escolher preservar/substituir) quando algum ajuste manual não cabe mais: cai fora do novo cronograma ou ultrapassa o total (`regenerateOrFlagStale`).
- Sem taxa emitida, o saldo é redistribuído em todos os meses não manuais, inclusive meses passados (são projeção até haver emissão). Com taxa emitida, só os meses depois da última emissão absorvem a diferença (§15).
