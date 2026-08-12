# Auditoria — DEGOLD_M15_Directional_Compass_8010_V1
Data: 2026-06-30 | Auditor: Claude (Sonnet 4.6)

---

## Resumo Executivo

O indicador possui boa estrutura de pipeline (regime → estrutura → VWAP → fluxo → aceitação → contexto Python) e parâmetros bem organizados. Porém foram identificados **4 bugs críticos** e **6 problemas de média/baixa gravidade** que precisam de correção antes de uso em produção.

---

## CRÍTICO — Deve corrigir antes de usar

### C1 · Memory Leak por Draw Objects acumulados (PaintAndDraw)

**Arquivo:** linha ~228 (`PaintAndDraw`)

```csharp
Draw.Line(this, "DG_VWAP_" + CurrentBar, ...);
Draw.Line(this, "DG_E21_"  + CurrentBar, ...);
Draw.Line(this, "DG_E200_" + CurrentBar, ...);
```

A chave inclui `CurrentBar`. A cada barra fechada são criados **3 novos objetos de desenho** que nunca são removidos. Em uma sessão de 6h com barras M15 isso são ~24 objetos por dia. Em backtests com meses de dados → dezenas de milhares de objetos acumulando na memória do gráfico, causando lentidão progressiva e eventual crash.

**Correção:** Use chave fixa, ou `false` no parâmetro `autoScale` e sobreponha o mesmo objeto:
```csharp
// VWAP: chave fixa, isAutoScale=false, sobrepõe a cada barra
Draw.Line(this, "DG_VWAP", false, 1, sessionVWAP, 0, sessionVWAP, Brushes.Gold, DashStyleHelper.Solid, 2);
Draw.Line(this, "DG_E21",  false, 1, ema21[1],    0, ema21[0],    Brushes.DeepSkyBlue, DashStyleHelper.Solid, 1);
Draw.Line(this, "DG_E200", false, 1, ema200[1],   0, ema200[0],   Brushes.White, DashStyleHelper.Dot, 1);
```

---

### C2 · Race Condition no contexto Python (Thread Safety)

**Arquivo:** `FetchPythonContextAsync()` + campos lidos em `OnBarUpdate`

```csharp
private async void FetchPythonContextAsync()   // dispara do thread de cálculo NT
{
    ...
    string json = await http.GetStringAsync(PythonUrl);  // continua em pool thread
    dealerBias = ExtractJsonString(...);   // ESCRITA em background thread
    ...
}
```

Após o `await`, o código de atribuição roda em um thread do ThreadPool, enquanto `OnBarUpdate` lê as mesmas variáveis do thread de cálculo do NT. Não há `lock`, `volatile` ou `Interlocked`. Resultado: valores corrompidos silenciosamente (tearing de 64 bits em `bridgeAuthority`, `dealerSignalScore`, etc.).

**Correção:** Salve os valores em variáveis locais e aplique via `Dispatcher.InvokeAsync` para o thread da UI do NT:
```csharp
// após o await, colete tudo em variáveis locais, depois:
await Dispatcher.InvokeAsync(() =>
{
    dealerBias   = localDealerBias;
    gammaRegime  = localGammaRegime;
    // ... restante das atribuições
    pythonState  = "ONLINE";
});
```

---

### C3 · `pythonFetchInFlight` sem sincronização atômica

**Arquivo:** `FetchPythonContextAsync()`, linha ~175

```csharp
if (pythonFetchInFlight || ...) return;
pythonFetchInFlight = true;   // gap não-atômico entre leitura e escrita
```

A verificação e a atribuição não são atômicas. Se `OnBarUpdate` chamar `FetchPythonContextAsync` em duas iterações consecutivas antes da task completar, duas tasks HTTP podem ser disparadas simultaneamente.

**Correção:**
```csharp
if (Interlocked.CompareExchange(ref _fetchInFlightFlag, 1, 0) != 0) return;
// ... finally: Interlocked.Exchange(ref _fetchInFlightFlag, 0);
private int _fetchInFlightFlag = 0; // substituir o bool
```

---

### C4 · `async void` engole exceções não tratadas

**Arquivo:** `FetchPythonContextAsync()`, linha ~173

`async void` é aceitável apenas em event handlers. Aqui, se ocorrer qualquer exceção **fora** do try-catch interno (ex.: `ObjectDisposedException` do `HttpClient`), ela sobe para o `SynchronizationContext` do NT e pode travar ou derrubar o processo sem mensagem de erro visível.

**Correção:** A assinatura não pode ser `async Task` no NT por restrições de chamada direta, mas adicione um catch-all externo ao try existente, ou dispare via `Task.Run().ContinueWith(...)` com tratamento explícito:
```csharp
private async void FetchPythonContextAsync()
{
    try
    {
        await FetchPythonContextInternalAsync();
    }
    catch (Exception ex)
    {
        pythonState = "OFFLINE";
        lastPythonError = "FATAL: " + (ex.Message.Length > 60 ? ex.Message.Substring(0, 60) : ex.Message);
    }
}
```

---

## ALTO — Bugs de lógica que afetam qualidade do sinal

### A1 · `BlockOnVixBlock` silenciosamente ineficaz no modo padrão

**Arquivo:** `OnBarUpdate`, linha ~248

```csharp
if (BlockOnVixBlock && vixBlock && TreatPythonAsContextOnly == false)
    direction = 0;
```

Por padrão `TreatPythonAsContextOnly = true`, então mesmo com `BlockOnVixBlock=true` e VIX bloqueando, **a direção nunca é zerada**. O painel mostra "BLOQUEIO" mas o sinal de compra/venda continua ativo. O usuário que ativa `BlockOnVixBlock` sem perceber essa dependência vai tomar sinais que achou que estavam bloqueados.

**Correção:** Desacoplar a lógica:
```csharp
if (BlockOnVixBlock && vixBlock)
    direction = 0;
```

---

### A2 · `ApplyPythonContext` aplica boost ao lado errado quando dealer e visual divergem

**Arquivo:** `ApplyPythonContext`, linha ~156

```csharp
if (IsBullText(dealerBias) || IsBullText(visualConfirmSide))
{
    buyScore += dealerBoost + visualBoost;  // ambos os boosts vão para compra
    ...
}
```

Se `dealerBias="BULL"` e `visualConfirmSide="BEAR"`, a condição é verdadeira pelo dealer. `dealerBoost` vai para buy — correto. Mas `visualBoost` (calculado de `visualConfirmPercent` que representa força do sinal visual bearish) também vai para buy — incorreto. O boost visual deveria ser condicional à concordância do visual com a direção.

**Correção:**
```csharp
bool dealerBull = IsBullText(dealerBias);
bool visualBull = IsBullText(visualConfirmSide);
if (dealerBull || visualBull)
{
    if (dealerBull)  buyScore += dealerBoost;
    if (visualBull)  buyScore += visualBoost;
    buyReasons += "PY8010_BULL ";
    if (IsBearText(gammaRegime)) buyScore -= 4;
}
```

---

## MÉDIO — Imprecisões que distorcem leituras

### M1 · `GetSessionVWAPApprox` não calcula VWAP do passado

**Arquivo:** `GetSessionVWAPApprox`, linha ~293

A função retorna a média típica das barras `[barsAgo, barsAgo+15]`, **não** o VWAP acumulado da sessão no ponto `barsAgo`. Como resultado, `vwapSlopeTicks` compara o VWAP acumulado atual com um trecho local do passado recente — valores com escalas e métodos de cálculo diferentes.

Isso pode gerar falsos `VWAP_SLOPE_UP/DOWN` especialmente nas primeiras horas da sessão, quando o VWAP ainda está sendo dominado pelo gap de abertura.

**Correção:** Mantenha um array de VWAPs históricos:
```csharp
private double[] vwapHistory = new double[50];
// em UpdateSessionVWAP():
if (CurrentBar < vwapHistory.Length) vwapHistory[CurrentBar % vwapHistory.Length] = sessionVWAP;
// em OnBarUpdate():
double pastVwap = vwapHistory[(CurrentBar - VwapSlopeLookback) % vwapHistory.Length];
double vwapSlopeTicks = (sessionVWAP - pastVwap) / TickSize;
```

---

### M2 · CVD proxy é basicamente um sinal de 1 barra, não acumulação de fluxo

**Arquivo:** `UpdateCvdProxy` + uso em `OnBarUpdate`

```csharp
bool cvdUp   = cvdProxy > cvdProxyPrev;   // cvdProxy - cvdProxyPrev = signedVol desta barra
bool cvdDown = cvdProxy < cvdProxyPrev;
```

`cvdProxy - cvdProxyPrev` é exatamente o `signedVol` da barra atual (close location * volume). Isso é essencialmente: "o close foi acima do meio do range?". A acumulação histórica existe mas nunca é usada para extrair tendência. Um CVD real deveria ser comparado com N barras atrás ou com sua própria SMA.

**Melhoria sugerida:**
```csharp
bool cvdUp   = cvdProxy > cvdProxyPrev * (1 + 0.001) && (cvdProxy - cvdProxyPrev) > 0;
// ou mantenha cvdHistory e compare cvdProxy atual vs. N barras atrás
```

---

### M3 · `http.Timeout` modificado em static compartilhado

**Arquivo:** `OnStateChange → State.Configure`, linha ~80

```csharp
private static readonly HttpClient http = new HttpClient();
...
http.Timeout = TimeSpan.FromMilliseconds(1200);  // muta objeto estático compartilhado
```

Se o mesmo NinjaTrader tiver dois gráficos com este indicador abertos (ativos diferentes, ou mesmo ativo em janelas diferentes), ambos configurarão o `Timeout` do mesmo `HttpClient`. Isso é race-prone e pode mudar o timeout de uma instância enquanto a outra está em plena requisição HTTP.

**Correção:** Inicialize na declaração:
```csharp
private static readonly HttpClient http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(1200) };
```
E remova a atribuição do `State.Configure`.

---

## BAIXO — Código morto e melhorias menores

### B1 · `lastScore` e `lastDirection` são campos mortos

**Arquivo:** Declaração e atribuição em `OnBarUpdate`

```csharp
lastDirection = direction;
lastScore = dominantScore;
```

São escritos mas nunca lidos em nenhum lugar do código. Se a intenção é expô-los para acesso externo (ex.: estratégia que consulta o indicador), precisam ser `public` ou expostos como `[Browsable(false)]` `[Display]` plots. Caso contrário, podem ser removidos.

---

### B2 · Penalidade VWAP distante afeta ambos os lados simetricamente

**Arquivo:** `OnBarUpdate`, linha ~185

```csharp
if (distanceVWAPAtr > MaxDistanceFromVWAPAtr)
{
    buyScore -= 7;
    sellScore -= 7;   // penaliza short mesmo quando preço está longe acima do VWAP
}
```

Quando preço está muito acima do VWAP, penalizar o `sellScore` dificulta que o indicador detecte setups de short por reversão/rejeição de sobreextensão — que são justamente os setups mais relevantes nessa condição. Considere penalizar apenas o lado na direção da sobreextensão.

---

### B3 · `IsBullText("LONG")` pode dar falso positivo

**Arquivo:** `IsBullText`, linha ~321

A string `"LONG"` é verificada com `.Contains("LONG")`. Se o servidor Python retornar algo como `"along"`, `"prolonged"`, `"oblong"` em qualquer campo de texto, isso vai acionar o side bull. Prefira verificar com palavras completas ou delimitadores.

---

### B4 · Falta `OnTermination` para limpeza

Não há override de `OnTermination()`. O `HttpClient` estático sobrevive normalmente, mas drawing objects e tasks assíncronas pendentes podem ficar em estado indefinido durante reload do indicador em backtests longos. Adicionar cleanup defensivo é recomendado.

---

## Tabela de Prioridade

| ID  | Gravidade | Área              | Impacto                                        |
|-----|-----------|-------------------|------------------------------------------------|
| C1  | CRÍTICO   | Performance       | Memory leak progressivo — crash em backtest    |
| C2  | CRÍTICO   | Thread Safety     | Corrupção silenciosa de dados Python           |
| C3  | CRÍTICO   | Thread Safety     | Double-fetch HTTP / dados inconsistentes       |
| C4  | CRÍTICO   | Estabilidade      | Crash NT por exceção não tratada               |
| A1  | ALTO      | Lógica de sinal   | `BlockOnVixBlock` inoperante no modo padrão    |
| A2  | ALTO      | Lógica de sinal   | Boost Python aplicado ao lado errado           |
| M1  | MÉDIO     | Precisão          | VWAP slope calculado com método incorreto      |
| M2  | MÉDIO     | Precisão          | CVD proxy é só leitura de 1 barra              |
| M3  | MÉDIO     | Estabilidade      | HttpClient timeout em objeto static compartilhado |
| B1  | BAIXO     | Código morto      | `lastScore`/`lastDirection` nunca lidos        |
| B2  | BAIXO     | Lógica de sinal   | Penalidade VWAP penaliza short incorretamente  |
| B3  | BAIXO     | Robustez          | `IsBullText("LONG")` pode ter falso positivo   |
| B4  | BAIXO     | Estabilidade      | Sem `OnTermination` para cleanup               |

---

## Pontos Positivos

- Pipeline de scoring bem estruturado e legível
- `Calculate.OnBarClose` correto para evitar repaint
- `IsSuspendedWhileInactive = true` economiza CPU
- `Clamp(buyScore, 0, 100)` antes da decisão evita overflow de score
- Fallback gracioso em todos os `ExtractJson*` (try/catch com fallback)
- Reset de VWAP/CVD por sessão implementado corretamente
- Bloqueio de `pythonFetchInFlight` para evitar sobreposição de requests (ideia certa, implementação precisa de Interlocked — ver C3)
- Lógica de compressão com ADX + ATR é razoável

---

## Ordem de Correção Recomendada

1. **C1** (Draw keys fixas) — rápido, alto impacto
2. **C3** (Interlocked no flag) — 3 linhas, elimina race
3. **M3** (HttpClient timeout estático) — 1 linha
4. **C4** (catch-all no async void) — proteção mínima imediata
5. **A1** (BlockOnVixBlock desacoplado) — 1 linha, lógica correta
6. **A2** (ApplyPythonContext boost condicional) — 10 linhas
7. **C2** (Dispatcher para escrita de campos Python) — maior esforço, crítico para produção
8. **M1** (vwapHistory array) — refatoração de GetSessionVWAPApprox
