# Etiquetas de Material

Site para gerar as etiquetas de material (o mesmo modelo da planilha "Etiquetas posto a posto"), com
cadastro de materiais e fotos. A tela é escura; a etiqueta impressa é branca, só com o texto.

```
┌──────────────────────────────────────┐
│ (BYD)                         BC22LE │
│              13020085-00             │
│         BYDQ33424T15F61KP1.5         │
│         BOM-1339 e BOM-1268          │
│ Porca hexagonal de metal     01.A.C2 │
│ com trava de nylon M6                │
└──────────────────────────────────────┘
```

## O que o site faz

- **Imprimir**: escolha os materiais (busca, filtro por projeto/linha, ordem por endereço), a quantidade
  de cópias de cada um e imprima em folha A4. Em **Tamanho e layout** dá para mudar o tamanho da etiqueta,
  papel, margens e linhas de corte, **aumentar ou diminuir as letras** (todas de uma vez ou cada campo:
  código, descrição, endereço, referência, BOM, projeto), escolher quantas linhas a descrição usa e
  **quais campos aparecem**. O site avisa quando o texto não cabe. A etiqueta tem só o texto (sem foto e
  sem QR code).
- **Materiais**: cadastro com foto. Dá para importar direto da planilha do Excel (arquivo `.xlsx`
  ou copiar e colar), editar, excluir e exportar de volta para o Excel. O filtro "Somente sem foto" mostra
  o que ainda falta fotografar.
- **Página do material** (`/m/<código>`, botão *Ver página*): feita para celular. Mostra a foto grande e onde
  o material fica; dá para **tirar a foto ali mesmo** pelo celular.
- **Configurações**: busca no Google, logo da etiqueta, PIN de edição e backup.

A foto é ligada ao **código do material**: se o mesmo código aparece em vários endereços/postos,
todos usam a mesma foto.

## Onde o site roda

O site fica hospedado na **Cloudflare**:

- a tela e a API rodam num **Worker** (`src/index.js` + pasta `public/`);
- o cadastro, as fotos e as configurações ficam no banco **D1** `etiquetas`
  (ID `6bb7d865-1698-498d-b9b3-20b0aaf37cd1`, configurado em `wrangler.jsonc`).

Como o site fica na internet, ele abre em qualquer computador ou celular — no Wi-Fi da empresa ou no 4G.
As tabelas do banco são criadas sozinhas no primeiro acesso; não é preciso rodar nada no D1.

### Publicar (uma vez só, pelo painel da Cloudflare)

1. No painel da Cloudflare, vá em **Workers e Pages → Criar → Importar um repositório**
   (*Workers & Pages → Create → Import a repository*).
2. Conecte o GitHub e escolha o repositório **T-800009/Etiquetas**.
3. Mantenha o comando de deploy `npx wrangler deploy` e clique em **Deploy**.
4. O site fica em um endereço como `https://etiquetas.<sua-conta>.workers.dev`.

Depois disso, cada alteração enviada para o branch `main` publica o site de novo automaticamente.

### Primeira configuração

1. **Logo**: o site vem com um logo provisório desenhado. Envie o arquivo oficial (PNG/JPG) em Configurações.
2. **PIN de edição** (recomendado): o site é acessível pela internet. Com PIN, qualquer um com o link pode
   consultar e imprimir, mas só quem sabe o PIN altera o cadastro e as fotos.

### Trazer os dados da planilha atual

Em **Materiais → Importar planilha**:

- escolha o arquivo `ETIQUETAS AUTO.xlsx` — o site já seleciona a aba "Entrada de Dados"; **ou**
- no Excel, selecione as linhas da aba "Entrada de Dados", copie (Ctrl+C) e cole no campo.

O site tenta adivinhar qual coluna é o código, a descrição, o endereço etc. Confira na tela de
importação e ajuste se precisar. Ao importar de novo, materiais com o mesmo **código + endereço + projeto**
são atualizados em vez de duplicados.

### Fotografar os materiais

- **Pelo celular**: abra a página do material (*Ver página*) e toque em **Tirar foto do material**.
- **Pelo computador**: em **Materiais**, clique no quadrinho "+ foto" ao lado do material.

- **Fotos da internet (Google)**: em **Materiais → Buscar fotos na internet** o site procura, para cada
  material sem foto, uma foto pela descrição, **tira o fundo** e salva. Ao editar um material,
  **Buscar na internet** mostra várias opções para escolher. A busca usa o **Google Imagens** pelo serviço
  [Serper.dev](https://serper.dev) (conta gratuita com créditos de busca); sem a chave configurada, usa
  bancos de fotos livres (Wikimedia Commons e Openverse). Essas fotos ficam com o selo **web** na lista e são
  trocadas quando alguém tira a foto no local.
  - Para ativar o Google: crie a conta no Serper.dev, copie a *API key* e, no painel da Cloudflare, vá em
    **Workers & Pages → etiquetas → Settings → Variables and Secrets → Add**, tipo *Secret*, nome
    `SERPER_API_KEY`.
  - A remoção de fundo funciona bem em fotos de produto com fundo liso (branco, cinza); fotos com cenário
    no fundo são salvas como estão.
  - Fotos do Google pertencem aos seus donos; use para identificação interna dos materiais.

As fotos são reduzidas automaticamente (no máximo 1280 px) antes de enviar.

## Onde ficam os dados

No banco D1 `etiquetas` da Cloudflare. O D1 guarda o histórico dos últimos dias: dá para voltar o banco
a um momento anterior em **D1 → etiquetas → Time Travel**. Em **Configurações → Cópia de segurança** também
dá para baixar o cadastro em JSON ou planilha.

## Para desenvolvedores

- `npm install`, `npx wrangler login` e depois `npm run dev`: roda o site localmente (`http://localhost:8787`) com um banco D1 local (a tradução usa a IA da conta da Cloudflare, por isso o login).
- `npm test`: sobe o Worker com `wrangler dev` (com IA e internet simuladas, `test/internet-falsa.js`) e testa a API.
- `npm run deploy`: publica pela linha de comando (precisa de `npx wrangler login`).

| Arquivo | Conteúdo |
| --- | --- |
| `src/index.js` | Worker: API, fotos, página do material e acesso ao banco D1 |
| `wrangler.jsonc` | configuração da Cloudflare (nome do Worker, banco D1, pasta `public`) |
| `public/index.html`, `app.js` | telas Imprimir, Materiais e Configurações |
| `public/etiqueta.css` | layout da etiqueta e da folha de impressão |
| `public/importar.js` | leitura de `.xlsx`, `.csv` e texto colado do Excel |
| `public/material.html`, `material.js` | página do material (celular) |
| `public/comum.js` | funções compartilhadas (API, PIN, redução de fotos, remoção de fundo) |
