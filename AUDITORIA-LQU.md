# Auditoria do Gerador + núcleo LQU

Data: 2026-10-20 · Ambiente: Node v22.22.0.

## Método

Auditoria por **oráculo independente**: cada afirmação matemática foi reverificada
com um algoritmo **diferente** do usado no código (para não validar o código com ele
mesmo), além da suíte de testes e revisão de robustez/segurança/honestidade.

## Resultado: aprovado, sem falhas de correção

- **Suíte automatizada:** 39 testes, 38 passam, 1 lento (gated). Typecheck limpo.
- **Verificação independente:** **1.943 checagens, 0 falhas.**

| Verificação | Oráculo independente | Resultado |
|---|---|---|
| Binomial (0≤n≤60) | Triângulo de Pascal (só somas) vs fórmula multiplicativa | ✅ idêntico; C(25,15)=3.268.760, C(60,6)=50.063.860 |
| Hipergeométrica P(X=r) | Fatoriais BigInt vs binomial do código | ✅ idêntico; soma = 1 exata (LF, Mega, casos extras) |
| Conferidor `ticketPrizes(size,hits)` | Força bruta enumerando todos os C(size,15) jogos | ✅ fórmula == contagem real (15,16,17,18 dezenas) |
| Fechamento Lotofácil | Força bruta dos 136 cenários (código diferente) | ✅ 128×14 + 8×15, 0 contraexemplos |
| Fechamento Mega-Sena | Força bruta dos 28 cenários | ✅ 24×5 + 4×6, 0 contraexemplos |
| `choose()` float do gerador | Comparado ao exato (BigInt) para n≤25 | ✅ exato em toda a faixa usada |
| Geração uniforme (rejeição) | Teste de viés em 70.000 amostras | ✅ sem viés de módulo |
| Autoteste do núcleo no navegador | — | ✅ 6/6 |

## Robustez e segurança

- **Entradas do usuário** (resultados colados): sanitizadas por regex de dígitos e
  filtro 1–25 → sem injeção de HTML/XSS.
- **Inicialização única** (`__lotofacilLabLoaded`) → sem volante/eventos duplicados.
- **Degradação graciosa**: se o núcleo não carregar, a sugestão cai no método antigo,
  o painel de probabilidades mostra aviso e o fechamento avisa em vez de quebrar.
- **Site público e artifact em sincronia** (mesma lógica; artifact com dados embutidos).

## Honestidade (conformidade com o contrato)

- Nenhuma alegação de previsão; disclaimers de "não aumenta a chance / não é previsão"
  presentes em múltiplos pontos. Frequência rotulada como descritiva.
- Fechamento sempre exibe a **condição** e sua probabilidade (≈ 1 em 24.035).

## Observações (baixa severidade — melhorias, não bugs)

1. **Painel de probabilidades exatas** pressupõe que você jogue *todas* as C(base,15)
   combinações (aposta ampliada). Se você gerar menos jogos, a chance real é menor.
   O aviso ameniza, mas o texto pode deixar isso mais explícito.
2. **Seleção de jogos no modo não-diversificar** ainda usa embaralhamento comum
   (`Math.random`), não o gerador uniforme do núcleo. Cosmético — a seleção é entre
   jogos já válidos; não afeta correção.
3. **"Dezenas por jogo"** vai até 18, embora a base aceite 20. É escolha de produto;
   poderia ir a 19/20 para ampliadas completas.
4. **Dados ao vivo**: fonte pública congelada no concurso 3246 e API da Caixa bloqueada
   (CORS/rede). Limitação externa, já documentada.

## Veredito

A base de cálculo e geração está **correta e verificável**. A garantia de fechamento é
**real e condicional** (provada por enumeração exaustiva). O produto é honesto: não
promete previsão. Nenhum achado de severidade média ou alta.
