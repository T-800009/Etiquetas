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

## Como usar (Windows)

1. Instale o **Node.js** (versão LTS) em <https://nodejs.org> — só precisa fazer isso uma vez.
2. Baixe esta pasta do projeto para o computador que vai ficar com o site.
3. Dê dois cliques em **`iniciar.bat`**. O navegador abre em `http://localhost:3000`.
   - Na primeira vez o Windows pode perguntar se libera o Node.js no firewall: permita na **rede privada**,
     senão os celulares não conseguem abrir o QR code.
4. A janela preta mostra também o endereço do computador na rede, algo como
   `http://192.168.0.10:3000`. Esse é o endereço que o celular usa.

Em Linux/macOS: `./iniciar.sh` (ou `npm start`).

### Primeira configuração

1. **Configurações → Endereço usado no QR code**: clique no endereço da rede que aparece
   (ex.: `http://192.168.0.10:3000`) e salve. Teste com o QR code de exemplo usando o celular
   conectado ao Wi-Fi da empresa. Sem isso, os QR codes apontam para `localhost` e não abrem no celular.
2. **Logo**: o site vem com um logo provisório desenhado. Envie o arquivo oficial (PNG/JPG).
3. **PIN de edição** (recomendado): com PIN, qualquer um pode consultar e imprimir, mas só quem sabe o
   PIN altera o cadastro e as fotos.

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

As fotos são reduzidas automaticamente (no máximo 1600 px) antes de enviar.

## Onde ficam os dados

Tudo fica na pasta `dados/`, ao lado do `server.js`:

- `dados/banco.json` — cadastro dos materiais e configurações;
- `dados/fotos/` — as fotos.

**Backup = copiar a pasta `dados` inteira.** Ela não vai para o Git (está no `.gitignore`).

## Hospedagem

O QR code só funciona onde o celular consegue chegar no site:

- **Computador na rede da empresa** (padrão): deixe um computador ligado com o `iniciar.bat` aberto.
  Os celulares precisam estar no Wi-Fi da empresa.
- **Servidor da TI / nuvem**: rode `node server.js` no servidor (porta em `PORT`, pasta de dados em
  `DADOS_DIR`) e coloque o endereço do servidor em Configurações. Assim funciona até fora do Wi-Fi.

## Para desenvolvedores

- Não usa dependências externas: só Node.js 18+. O QR code é gerado no navegador com a biblioteca
  [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT), incluída em `public/vendor/`.
- `npm test` roda os testes da API.
- Variáveis de ambiente: `PORT` (padrão 3000) e `DADOS_DIR` (padrão `./dados`).

| Arquivo | Conteúdo |
| --- | --- |
| `server.js` | servidor HTTP, API e armazenamento em JSON |
| `public/index.html`, `app.js` | telas Imprimir, Materiais e Configurações |
| `public/etiqueta.css` | layout da etiqueta e da folha de impressão |
| `public/importar.js` | leitura de `.xlsx`, `.csv` e texto colado do Excel |
| `public/material.html`, `material.js` | página aberta pelo QR code |
| `public/comum.js` | funções compartilhadas (API, PIN, QR code, redução de fotos) |
