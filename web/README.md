# ParkFlow · Build web (deploy estático)

Versão **autônoma** do ParkFlow para publicar em qualquer host estático
(Vercel, Netlify, GitHub Pages…). Não precisa de servidor: o app do cliente
usa um **mock do backend no próprio navegador** (`cliente/mock-api.js`) com a
mesma lógica do servidor real (tarifas, PIX EMV, confirmação simulada).

## Conteúdo
```
web/
├── index.html            # landing (links para cliente e operador)
├── cliente/
│   ├── index.html        # app do cliente (pagar pelo celular)
│   └── mock-api.js        # backend simulado no navegador
└── operador/
    ├── index.html        # painel do operador (totem, pátio, caixa, BI…)
    ├── styles.css
    └── app.js
```

## Publicar no Vercel a partir do Git (recomendado — site completo)
1. Em vercel.com → **Add New… → Project** → importe o repositório
   `luizcastrosax/15-agentes-gpt`.
2. Em **Root Directory**, selecione **`web`**.
3. **Framework Preset**: `Other` (site estático — sem build).
4. **Deploy**. Pronto:
   - `/` — landing
   - `/cliente/` — app do cliente
   - `/operador/` — painel do operador

> Assim o Vercel serve os arquivos direto do repositório (inclusive o painel
> do operador completo), sem precisar reenviar nada manualmente.

## Rodar localmente
Qualquer servidor estático apontando para `web/`, por exemplo:
```bash
npx serve web        # ou: python3 -m http.server -d web 4100
```

## Versão com backend real
Para o sistema com banco de dados e webhook PIX de verdade (não simulado),
use a pasta [`../server`](../server) (Node.js + SQLite). Nesse caso o app do
cliente e o painel conversam com a API real e compartilham o mesmo banco.
