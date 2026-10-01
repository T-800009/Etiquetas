# Etiquetas de Material

Site para gerar as etiquetas de material (o mesmo modelo da planilha "Etiquetas posto a posto")
com um **QR code** em cada etiqueta. Ao apontar a câmera do celular para o QR code, abre uma página
com a **foto daquele material**, a descrição, a referência, o BOM e onde ele fica.

```
┌───────────────────────────────────────────┐
│ (BYD)                  BC22LE  ┌────────┐ │
│          13020085-00           │ ▓▓ ▓ ▓ │ │
│      BYDQ33424T15F61KP1.5      │ ▓ ▓▓ ▓ │ │  ← QR code: abre a foto do material
│      BOM-1339 e BOM-1268       │ ▓▓▓ ▓▓ │ │
│ Porca hexagonal de      01.A.C2└────────┘ │
│ metal com trava                           │
└───────────────────────────────────────────┘
```

## O que o site faz

- **Foto na etiqueta**: ao lado do texto, a etiqueta mostra a **foto do material** (padrão). Material ainda
  sem foto sai com o QR code no lugar. Em *Tamanho e layout → Ao lado do texto* dá para trocar para
  "QR code" ou "Nada".
- **Imprimir**: escolha os materiais (busca, filtro por projeto/linha, ordem por endereço), a quantidade
  de cópias de cada um e imprima em folha A4. Tamanho da etiqueta, margens, orientação e linhas de corte
  são configuráveis. Textos compridos diminuem para caber, em vez de serem cortados como no Excel.
- **Materiais**: cadastro com foto. Dá para importar direto da planilha do Excel (arquivo `.xlsx`
  ou copiar e colar), editar, excluir e exportar de volta para o Excel. O filtro "Somente sem foto" mostra
  o que ainda falta fotografar.
- **Página do QR code** (`/m/<código>`): feita para celular. Mostra a foto grande e onde o material fica.
  Se o material ainda não tem foto, dá para **tirar a foto ali mesmo** pelo celular.
- **Configurações**: endereço usado no QR code, logo da etiqueta, PIN de edição e backup.

A foto é ligada ao **código do material**: se o mesmo código aparece em vários endereços/postos,
todas as etiquetas mostram a mesma foto.

## Onde o site roda

O site fica hospedado na **Cloudflare**:

- a tela e a API rodam num **Worker** (`src/index.js` + pasta `public/`);
- o cadastro, as fotos e as configurações ficam no banco **D1** `etiquetas`
  (ID `6bb7d865-1698-498d-b9b3-20b0aaf37cd1`, configurado em `wrangler.jsonc`).

Como o site fica na internet, o QR code abre em qualquer celular — no Wi-Fi da empresa ou no 4G.
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
3. **Endereço do QR code**: deixe em branco (usa o endereço do próprio site). Só preencha se colocar um
   domínio próprio no Worker.

### Trazer os dados da planilha atual

Em **Materiais → Importar planilha**:

- escolha o arquivo `ETIQUETAS AUTO.xlsx` — o site já seleciona a aba "Entrada de Dados"; **ou**
- no Excel, selecione as linhas da aba "Entrada de Dados", copie (Ctrl+C) e cole no campo.

O site tenta adivinhar qual coluna é o código, a descrição, o endereço etc. Confira na tela de
importação e ajuste se precisar. Ao importar de novo, materiais com o mesmo **código + endereço + projeto**
são atualizados em vez de duplicados.

### Fotografar os materiais

- **Pelo celular** (mais prático): imprima as etiquetas, escaneie o QR code e toque em
  **Tirar foto do material**.
- **Pelo computador**: em **Materiais**, clique no quadrinho "+ foto" ao lado do material.

- **Fotos da internet**: em **Materiais → Buscar fotos na internet** o site procura, para cada material sem
  foto, uma foto pela descrição e usa a primeira encontrada. Ao editar um material, **Buscar na internet**
  mostra várias opções para escolher. As fotos vêm do Wikimedia Commons e do Openverse (fotos livres, sem
  precisar de chave); a descrição é traduzida para inglês pela IA da Cloudflare antes da busca. Essas fotos
  ficam com o selo **web** na lista e são trocadas quando alguém tira a foto no local. O autor e a licença
  aparecem em letra pequena no rodapé da página do QR code, como pedem as licenças dessas fotos.

As fotos são reduzidas automaticamente (no máximo 1280 px) antes de enviar.

## Onde ficam os dados

No banco D1 `etiquetas` da Cloudflare. O D1 guarda o histórico dos últimos dias: dá para voltar o banco
a um momento anterior em **D1 → etiquetas → Time Travel**. Em **Configurações → Cópia de segurança** também
dá para baixar o cadastro em JSON ou planilha.

## Para desenvolvedores

- `npm install`, `npx wrangler login` e depois `npm run dev`: roda o site localmente (`http://localhost:8787`) com um banco D1 local (a tradução usa a IA da conta da Cloudflare, por isso o login).
- `npm test`: sobe o Worker com `wrangler dev` (com IA e internet simuladas, `test/internet-falsa.js`) e testa a API.
- `npm run deploy`: publica pela linha de comando (precisa de `npx wrangler login`).
- O QR code é gerado no navegador com a biblioteca
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), incluída em `public/vendor/`.

| Arquivo | Conteúdo |
| --- | --- |
| `src/index.js` | Worker: API, fotos, página do QR code e acesso ao banco D1 |
| `wrangler.jsonc` | configuração da Cloudflare (nome do Worker, banco D1, pasta `public`) |
| `public/index.html`, `app.js` | telas Imprimir, Materiais e Configurações |
| `public/etiqueta.css` | layout da etiqueta e da folha de impressão |
| `public/importar.js` | leitura de `.xlsx`, `.csv` e texto colado do Excel |
| `public/material.html`, `material.js` | página aberta pelo QR code |
| `public/comum.js` | funções compartilhadas (API, PIN, QR code, redução de fotos) |
