# T800 HACK — Cloudflare Worker

Projeto mantido em `T-800009/Etiquetas`, branch `cyber-tutor-site`, pasta `cyber-tutor`.

O Worker `t800-hack` serve somente os arquivos de `public/`, incluindo a imagem original do T-800. O aplicativo usa a conta Puter do visitante, com histórico no navegador e importação/exportação de conversas. Esta configuração publica diretamente na conta Cloudflare autenticada, em seu subdomínio `workers.dev`.

## Integração GitHub → Cloudflare

Configure o Worker no painel Cloudflare com estes valores:

| Campo | Valor |
| --- | --- |
| Repositório | `T-800009/Etiquetas` |
| Branch de produção | `cyber-tutor-site` |
| Diretório raiz | `cyber-tutor` |
| Comando de build | `npm test` |
| Comando de deploy | `npm run deploy` |
| Nome do Worker | `t800-hack` |

O Cloudflare instala as dependências pelo `package-lock.json` e usa a autenticação da sua própria integração GitHub. Não coloque tokens no código. Após a primeira publicação, novos commits nessa branch podem disparar a atualização automática do Worker.

## Publicação pelo terminal

```sh
cd cyber-tutor
npm ci
npx wrangler login
npm test
npm run deploy
```

Com uma sessão Cloudflare já autorizada, `bash deploy-worker.sh` instala as dependências fixadas, verifica a aplicação e publica.

## Desenvolvimento e verificação

```sh
npm run dev
npm test
npx wrangler deploy --config ./wrangler.toml --dry-run
```

`/api/health` informa a versão do Worker. Os testes verificam os arquivos servidos, histórico, formatação de código, importação/exportação, contexto de mensagens e erros de streaming. A geração real de respostas requer uma sessão Puter autenticada e disponibilidade/crédito no provedor.
