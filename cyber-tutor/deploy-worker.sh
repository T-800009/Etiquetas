#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[T800 HACK] Instalando a versão fixada do Wrangler..."
npm ci

echo "[T800 HACK] Verificando a aplicação..."
npm test

echo "[T800 HACK] Publicando Worker..."
npm run deploy

echo "[T800 HACK] Deploy concluido."
