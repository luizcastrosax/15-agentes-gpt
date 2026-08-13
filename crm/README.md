# CRM do Curso

CRM completo para escolas e cursos livres: captacao de leads, funil de vendas,
**link publico de inscricao**, **controle de presenca**, financeiro, relatorios e
portal do aluno.

Feito em Next.js 15 (App Router) + TypeScript + Tailwind CSS, pronto para rodar na Vercel.

---

## O que ele faz

### Comercial (o basico de qualquer CRM)
- **Funil de vendas kanban** com arrastar e soltar, etapas personalizaveis, valor
  por etapa, probabilidade, previsao ponderada e motivo de perda.
- **Contatos 360**: dados cadastrais, etiquetas, campos personalizados, responsavel,
  origem, historico, anotacoes, tarefas, negocios, matriculas, presenca e financeiro
  na mesma tela.
- **Tarefas e agenda**: ligacoes, reunioes, e-mails e follow-ups com prazo,
  visao de atrasadas / hoje / proximas.
- **Busca global** (Ctrl+K), filtros combinados, selecao em massa
  (etiquetar, mudar situacao, trocar responsavel, arquivar, excluir).
- **Importacao e exportacao CSV** com deduplicacao por e-mail/telefone.
- **Modelos de mensagem** para WhatsApp e e-mail com variaveis
  (`{{nome}}`, `{{curso}}`, `{{turma}}`, `{{link}}`, `{{frequencia}}`...),
  abrindo direto no WhatsApp Web ou no cliente de e-mail.
- **Relatorios**: conversao, ticket medio, receita por mes e por curso,
  desempenho por origem, motivos de perda, ocupacao e frequencia das turmas.

### Especifico de curso
- **Cursos e turmas**: valor, carga horaria, modalidade, professor, local,
  dias da semana, horario, vagas e frequencia minima.
- **Link publico de inscricao por turma** (`/i/TOKEN`) com QR code e envio por
  WhatsApp. Cada inscricao cria automaticamente o contato, a pre-matricula e um
  negocio no funil.
- **Controle de presenca**: chamada rapida (presente / atrasado / justificado / falta),
  "todos presentes", encerramento da chamada marcando faltas automaticamente,
  mapa de frequencia da turma e alerta de **alunos em risco de evasao**.
- **Check-in do aluno por QR code** (`/checkin/TOKEN`): o aluno confirma a presenca
  pelo celular com o e-mail ou telefone do cadastro.
- **Portal do aluno** (`/portal/TOKEN`): aulas, frequencia e pagamentos.
- **Financeiro**: geracao automatica de parcelas na matricula, baixa de pagamento,
  inadimplencia e receita por mes.

### Administracao
- Login com sessao assinada (cookie httpOnly), senhas com scrypt + salt.
- Perfis: **admin**, **staff** (operacional) e **viewer** (somente leitura).
- Personalizacao da marca, do formulario publico, das etapas do funil,
  etiquetas, campos personalizados, origens e motivos de perda.
- Backup em JSON e reinicializacao com dados de exemplo.

---

## Rodando localmente

```bash
cd crm
npm install
cp .env.example .env.local   # defina ADMIN_PASSWORD
npm run dev
```

Acesse http://localhost:3000 e entre com `admin@crm.local` e a senha de `ADMIN_PASSWORD`
(padrao `admin123` se a variavel nao existir).

---

## Variaveis de ambiente

| Variavel | Obrigatoria | Para que serve |
| --- | --- | --- |
| `ADMIN_PASSWORD` | recomendada | Senha do primeiro administrador criado na base inicial. |
| `AUTH_SECRET` | recomendada | Segredo que assina o cookie de sessao. |
| `DATABASE_URL` | para persistir | String de conexao Postgres (Neon / Vercel Postgres). |

> `ADMIN_PASSWORD` so vale na **criacao** da base. Depois disso a senha vive no banco
> e e trocada em Configuracoes > Usuarios.

---

## Persistencia

Todo o CRM e guardado como um documento JSON, com dois backends:

- **Postgres** (quando existe `DATABASE_URL`): tabela `crm_doc`, criada sozinha no
  primeiro acesso, com trava otimista por versao para escritas concorrentes.
- **Memoria** (quando nao ha banco): o app funciona por completo, mas os dados somem
  quando a funcao serverless recicla. Serve para testar; o painel avisa em amarelo.

### Ligando o banco na Vercel

1. No painel do projeto, abra **Storage**.
2. Crie ou conecte um **Neon Postgres** (o plano gratuito ja atende).
3. A Vercel injeta `DATABASE_URL` sozinha.
4. Faca um novo deploy — as tabelas sao criadas no primeiro acesso.

---

## Estrutura

```
src/
  app/
    (app)/            paineis internos (protegidos por login)
    i/[token]/        formulario publico de inscricao
    checkin/[token]/  check-in de presenca do aluno
    portal/[token]/   portal do aluno
    api/              login, estado, mutacoes e endpoints publicos
  components/         UI, provider de dados, graficos, QR code
  lib/
    types.ts          modelo de dados
    db.ts             persistencia (Postgres + fallback em memoria)
    mutations.ts      todas as escritas, em um reducer no servidor
    selectors.ts      frequencia, funil, financeiro, indicadores
    shared.ts         formatacao, CSV, templates
    seed.ts           base de demonstracao
```

Toda escrita passa por `POST /api/mutate` com uma lista de acoes tipadas, validadas
no servidor. A leitura vem de `GET /api/state`, ja sem os hashes de senha.
