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

**O projeto ja existe e esta ligado ao git.** Nao crie outro.

| | |
| --- | --- |
| Projeto | `crm-curso` |
| Project id | `prj_iNwZl5VMxGge6r3kSnMSdR7WHFSD` |
| Time | `luiz` / `luizcastrosax` (`team_1PEenru9KsTsjVnP5AKJLOGv`) |
| Root Directory | `crm` |
| Production branch | `main` |

Publicar = **dar push na `main`**. Nao existe passo manual.

Ferramenta usada para criar: `create_git_project` (Vercel MCP). Ela e a certa para
repositorio git; `deploy_to_vercel` so serve para arquivos soltos e tem limite de
256 caracteres no `installCommand`.

### Variaveis de ambiente

Nenhuma ferramenta MCP define env var — isso e manual no painel, em
Settings > Environment Variables:

- `ADMIN_PASSWORD` — senha do primeiro admin. **Sem ela o app sobe com `admin123`**
  e a interface mostra faixa vermelha de alerta.
- `AUTH_SECRET` — segredo do cookie de sessao.
- `DATABASE_URL` — entra sozinha ao conectar Neon em Storage. Sem ela, modo memoria.

### Se o gate de permissao voltar

Chamadas de escrita na Vercel podem retornar `MCP error -32003: requires approval`.
Aconteceu doze vezes nesta sessao antes de passar. **Nao insista mais que duas
vezes** — avise o usuario e ofereca o import manual ou um token para a CLI.
Nunca invente uma URL de deploy.

Projetos criados na conta pessoal do usuario nao aparecem em `list_projects`, que so
enxerga o time `luiz`. Se ele disser que implantou e a lista vier vazia, peca a URL
em vez de afirmar que falhou.

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
