# Implantação na Vercel (roteiro — não executado)

> Situação: **não iniciado**. O app web (§5, §17, §23) ainda não existe, portanto não há
> deployment verificado. Não afirmar publicação enquanto apenas o núcleo compila/testa.
> A integração GitHub↔Vercel **não** é presumida.

Quando o `apps/web` existir, o fluxo verificável é (§23):

1. **Importar o projeto** na Vercel apontando para este repositório, raiz
   `lottery-quant-ultra/` (monorepo; definir o diretório do app em *Root Directory*).
2. **Configurar recursos** separados por ambiente (dev/preview/production): banco
   (Neon), objetos (Blob), identidade (Clerk), fila e segredos. Preview nunca recebe
   credenciais de produção.
3. **Variáveis de ambiente**: a partir de `.env.example`, sem prefixo público em segredos;
   validar coerência `APP_ENV` × recursos.
4. **Migrações** expand/contract testadas antes de promover; rollback de código não desfaz
   banco/objetos.
5. **Preview → checks → migração → produção preparada sem domínio → verificação →
   promoção → verificação posterior.** Desativar atribuição automática de domínio quando o
   fluxo exigir; usar usuário técnico para consumidores/cron (evitar ativação dupla).
6. **Confirmar documentação atual** de Node, funções, filas, cron e storage; `at-least-once`
   exige idempotência no banco.

Antes de qualquer contratação paga, apresentar o recurso necessário e o custo aplicável
(§24). Não prometer gratuidade nem custo fixo sem planos e medições.

## Observação sobre a Vercel neste ambiente

Há ferramentas de integração Vercel disponíveis nesta sessão, mas não há app para publicar
ainda. A publicação será proposta explicitamente quando o `apps/web` estiver pronto e
testado — não antes.
