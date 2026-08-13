---
name: crm-curso
description: Contexto do CRM de cursos que vive na pasta crm/ - como rodar, testar, publicar na Vercel e onde ficam as coisas. Use ao mexer em qualquer arquivo dentro de crm/, ao investigar matricula, presenca, funil ou financeiro, ou quando o usuario pedir para publicar/implantar o CRM.
---

# CRM do Curso

App Next.js 15 (App Router) + TypeScript + Tailwind 4 na pasta `crm/`. Convive no
mesmo repositorio com o site estatico da Lotofacil (HTML na raiz) — os dois nao se
tocam.

## Rodar e testar

```bash
cd crm
npm install
ADMIN_PASSWORD=teste123 npm run dev     # http://localhost:3000
npm run build                            # sempre rode antes de commitar
```

Login inicial: `admin@crm.local` + o valor de `ADMIN_PASSWORD` (padrao `admin123`).

Para teste de fumaca dos fluxos publicos, suba o build de producao e use curl:

```bash
cd crm && npm run build
ADMIN_PASSWORD=teste123 npx next start -p 3111 &
curl -s -c /tmp/c.txt -X POST localhost:3111/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@crm.local","password":"teste123"}'
curl -s -b /tmp/c.txt localhost:3111/api/state | head -c 400
```

Endpoints publicos que valem testar: `/api/public/form/<enrollToken>`,
`POST /api/public/enroll`, `GET|POST /api/public/checkin/<checkinToken>`,
`GET /api/public/portal/<portalToken>`.

## Arquitetura em uma frase

O CRM inteiro e **um documento JSON**. Toda leitura vem de `GET /api/state`; toda
escrita passa por `POST /api/mutate` com uma lista de acoes tipadas.

| Arquivo | Papel |
| --- | --- |
| `src/lib/types.ts` | modelo de dados (`CrmData` e todas as entidades) |
| `src/lib/db.ts` | persistencia: Postgres via `DATABASE_URL`, senao memoria |
| `src/lib/mutations.ts` | **todas** as escritas, num reducer no servidor |
| `src/lib/selectors.ts` | frequencia, funil, financeiro, indicadores |
| `src/lib/shared.ts` | formatacao, CSV, templates (seguro no client) |
| `src/lib/seed.ts` | base de demonstracao |
| `src/components/DataProvider.tsx` | estado no client, `useCrm()`, `mutate()` |

**Para adicionar uma funcionalidade que grava algo:** crie a acao em
`Action` (mutations.ts), trate no `switch` de `applyAction`, e chame
`mutate({ type: "..." })` na tela. Nao crie rota de API nova para CRUD — o
`/api/mutate` ja cobre `upsert` e `remove` de qualquer colecao.

**Nunca** exponha `passwordHash` ao client: `sanitize()` em mutations.ts limpa isso,
mantenha assim.

## Persistencia

- Com `DATABASE_URL` (Neon/Vercel Postgres): tabela `crm_doc`, criada sozinha no
  primeiro acesso, com trava otimista por versao.
- Sem banco: tudo em memoria. O app funciona inteiro, mas os dados somem quando a
  funcao serverless recicla. A barra lateral avisa em amarelo.

`ADMIN_PASSWORD` so vale na **criacao** da base. Depois disso a senha vive no banco;
trocar em Configuracoes > Usuarios.

## Publicar na Vercel

Caminho que funciona — importar o repositorio pelo git:

1. https://vercel.com/new → importar `luizcastrosax/15-agentes-gpt`
2. **Root Directory: `crm`** ← sem isso a Vercel tenta buildar o site da Lotofacil
3. Env vars: `ADMIN_PASSWORD` e `AUTH_SECRET`
4. Deploy
5. Depois: Storage → Neon Postgres → `DATABASE_URL` entra sozinha → Redeploy

O CRM esta na `main`, entao nao e preciso mexer em Production Branch.

### Armadilha conhecida

A ferramenta MCP `deploy_to_vercel` foi tentada dez vezes nesta sessao e retornou
sempre `MCP error -32003: requires approval` — um gate de permissao do ambiente.
Numa unica tentativa ela passou e a Vercel respondeu `installCommand should NOT be
longer than 256 characters`, o que prova que o bloqueio nao e do codigo.

Se voce for tentar de novo e o gate continuar: **nao insista mais que duas vezes**.
Diga ao usuario e ofereca (a) o import pelo git acima, ou (b) um token da Vercel
para deploy pela CLI. Nunca invente uma URL de deploy.

A conta Vercel visivel pela integracao e o time `luiz` / `luizcastrosax`
(`team_1PEenru9KsTsjVnP5AKJLOGv`). Projetos criados na conta pessoal do usuario
nao aparecem em `list_projects` — se ele disser que implantou e a lista vier vazia,
e provavelmente isso; peca a URL em vez de afirmar que falhou.

## Convencoes

- Textos da interface em portugues, **sem acentos** no codigo-fonte (evita
  problema de encoding em build). Comentarios idem.
- Tailwind 4: `@apply` so aceita utilitarios, nao classes proprias. As variantes de
  botao em `globals.css` sao escritas por extenso de proposito — nao "simplifique"
  para `@apply btn ...`, quebra o build.
- Paginas sao client components. Nao use `useSearchParams` (exige Suspense no
  build) — leia `window.location.search` dentro de `useEffect`.
- Rotas dinamicas do Next 15: `params` e uma Promise nas rotas de API
  (`ctx: { params: Promise<{ token: string }> }`).
