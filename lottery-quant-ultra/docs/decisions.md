# Registro de decisões

## D1 — Projeto isolado em subdiretório
O repositório já hospeda um site estático de Lotofácil publicado no GitHub Pages.
LOTTERY QUANT ULTRA é um app distinto e muito mais amplo. Para não quebrar o site
existente, o novo projeto vive em `lottery-quant-ultra/`. Decisão reversível: pode ser
promovido à raiz quando o app web existir.

## D2 — Node 22 em vez de 24
O contrato propõe Node 24.x "confirmando suporte atual". O ambiente de desenvolvimento
oferece Node v22.22.0. O núcleo usa apenas recursos estáveis (bigint, `node:test`,
`node:crypto`). `engines` declara `>=22`. Confirmar runtime da Vercel ao implementar
o app (§23) antes de fixar a versão.

## D3 — Runner de testes: `node:test` + `tsx`
Sem framework de teste externo pesado. `node --import tsx --test` roda TypeScript direto,
mantendo o núcleo sem dependências de runtime além de `@lqu/*`. Dev-deps: `tsx`,
`typescript`, `@types/node`.

## D4 — `math-core` puro
`math-core` não importa rede, DB, auth, env nem `node:crypto`. A fonte aleatória é injetada
(interface `RNG`). `SplitMix64` (determinístico) vive no núcleo; a fonte do sistema
pertence a uma camada superior. `verification` pode usar `node:crypto` (hash de certificado).

## D5 — Branch-and-bound exato para cobertura
As fixtures de §21.1 exigem **ótimos** conhecidos. Guloso não garante ótimo; usamos B&B
com limite superior admissível. Suficiente para instâncias pequenas (N≤9 nas fixtures).
O adaptador de solver (MIP) para instâncias grandes é módulo posterior (§9.3), não iniciado.

## D6 — Pareamento canônico dos fechamentos
A construção de fechamento aceita qualquer `S`; o pareamento padrão emparelha dezenas
ordenadas (0-1, 2-3, …). Qualquer pareamento disjunto satisfaz a prova estrutural (§10.3);
o canônico torna o resultado reprodutível e o hash estável.

## D7 — Fixtures lentas atrás de flag
A cobertura incondicional exaustiva (§21.1 opcional) roda só com `LQU_RUN_SLOW=1`
(`npm run test:slow`) para manter `npm test` rápido no CI. Foi executada e confere
(1096 = 1088×14 + 8×15).

## D8 — Sem previsão, sem simulação como prova
Decisão transversal do contrato (§3): nenhuma funcionalidade alega prever sorteios ou
garantir lucro; execução concluída não é prova de otimalidade; ausência de contraexemplo
em amostra não é prova de fechamento. O verificador é exaustivo, não amostral.
