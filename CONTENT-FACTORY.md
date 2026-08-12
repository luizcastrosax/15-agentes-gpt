# Content Factory — 12 Motores

Arquivo: `content-factory.html` · Rota em produção: `/factory`

Um briefing entra. O sistema roteia cada etapa para a IA certa e devolve o pacote
de produção completo: pesquisa, título, roteiro, storyboard, prompts de vídeo
separados por motor, narração, EDL, empacotamento, Shorts, plano de monetização
e um red team que ataca o próprio resultado.

Página estática, sem build e sem backend. Roda no Vercel, no GitHub Pages ou
com um duplo clique no arquivo.

---

## O que é automático e o que não é

Isto importa mais do que a lista de features.

| Etapa | Status |
|---|---|
| Motores 01–04, 07–12 (texto, estratégia, roteiro, storyboard, EDL, Shorts, monetização, red team) | **100% automático**, um clique |
| Motor 05 — imagens | Prompts prontos em inglês, com direção de arte e notas de consistência. A geração é colada no Flow/Imagen/seu gerador |
| Motor 06 — vídeo | Roteamento automático por cena + prompt escrito no formato de cada motor. A geração roda no Flow, Runway ou Sora |
| Motor 07 — voz | Automático de verdade: com a chave do ElevenLabs, o MP3 sai pronto na própria página |
| Montagem final | Humana. O sistema entrega EDL, SRT, mapa de cortes e briefing de trilha |

A montagem ser humana não é limitação técnica — é o que sustenta a autoria.
Conteúdo repetitivo e sem contribuição criativa relevante é exatamente o que
fica fora da monetização. O Motor 12 checa isso antes de você publicar.

---

## Roteamento

O roteamento do Motor 06 é **determinístico**. O cérebro central classifica
cada cena (`tipo`); a função `rotearCena()` converte tipo em motor de vídeo.
Modelo nenhum escolhe a ferramenta — o código escolhe.

| `tipo` da cena | Motor | Por quê |
|---|---|---|
| `dialogo`, `fisica` | **Sora 2** | Diálogo, física realista, áudio e efeitos nascendo sincronizados na cena |
| `personagem`, `vfx` | **Runway Gen-4.5** | Personagem recorrente, continuidade, referência de imagem, VFX, movimento controlado |
| `cinematografico`, `broll`, `transicao` | **Google Flow + Veo** | Plano narrativo, recriação histórica, cena bíblica, B-roll, passagem entre blocos |

Tipo desconhecido cai em Flow + Veo. Se o modelo devolver um motor inválido no
Motor 06, o take é re-roteado pelo tipo da cena original.

---

## Configuração

Tudo fica no `localStorage` do seu navegador. Nada é enviado para este site.

1. **Cérebro central** — provedor (Anthropic ou OpenAI/compatível), API key e id
   do modelo. O campo de modelo é livre: digite qualquer id que sua conta tenha.
2. **Voz** *(opcional)* — chave e `voice_id` do ElevenLabs. É aqui que entra sua
   voz clonada, se você criar uma.
3. **Entrega** *(opcional)* — URL de webhook (Make, n8n, Zapier). Ao terminar, o
   dossiê completo é enviado por POST em JSON, com o Markdown já montado no campo
   `dossie_md` — de onde ele segue para o Drive, e-mail ou Notion.

### Chave no navegador

A chave vai direto do seu navegador para a API do provedor. É o modelo de
ferramenta pessoal. Se você for hospedar isto num endereço público e usado por
outras pessoas, preencha **Endpoint** com um proxy seu que guarde a chave no
servidor — o resto do sistema não muda.

---

## Uso

1. Escreva o briefing. Pode ser um tema, uma pergunta ou um parágrafo torto;
   o Motor 01 refina.
2. Escolha vertical, duração, nº de Shorts e tom.
3. **Rodar os 12 motores.** Cada motor recebe o resultado dos anteriores —
   é um pipeline, não 12 prompts soltos.
4. Baixe o que precisar:

| Arquivo | Conteúdo |
|---|---|
| `.md` | Dossiê completo, pronto para ler ou mandar para a equipe |
| `.json` | Tudo estruturado, para automação |
| `.srt` | Legendas com timecode, direto do storyboard |
| `-prompts.txt` | Prompts de vídeo agrupados por motor + imagens-âncora |
| `narracao.mp3` | Narração, quando o ElevenLabs está configurado |

Motores podem ser desligados individualmente na coluna da esquerda. Rodada
completa: 12 chamadas sequenciais, tipicamente 3 a 6 minutos.

---

## Estrutura do vídeo longo

Padrão imposto ao Motor 03:

```
00:00–00:20  HOOK               choque + lacuna + recompensa
00:20–00:45  PROMESSA
00:45–02:00  CONTEXTO
02:00–05:00  DESENVOLVIMENTO
~05:00       PATTERN INTERRUPT
05:00–08:00  DESCOBERTA
08:00–10:00  PAYOFF
finalização  CTA / próxima curiosidade
```

O prompt de sistema proíbe abertura de boas-vindas. Começa no conflito.

---

## Pirâmide de conteúdo

Uma pauta gera, no Motor 10: o vídeo longo, 4 a 8 Shorts com hook próprio de
2 segundos, 2 Reels, 2 TikToks, carrossel de Instagram, post autônomo para
X/LinkedIn e o gancho do próximo vídeo. Entre 10 e 15 ativos por pesquisa.

---

## Extensões previstas

- Trocar o webhook por uma fila (o dossiê já sai em JSON estável).
- Fila de briefings para rodar a semana inteira de uma vez.
- Chamada direta às APIs de vídeo — hoje são assíncronas e bloqueiam chamada
  a partir do navegador, então exigiriam um proxy. Os prompts já saem no
  formato exato de cada motor, prontos para esse passo.
