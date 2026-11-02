#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "[T800 HACK] Instalando Wrangler..."
npm install

echo "[T800 HACK] Verificando login Cloudflare..."
npx wrangler whoami || npx wrangler login

echo "[T800 HACK] Publicando Worker..."
npx wrangler deploy

echo "[T800 HACK] Deploy concluido."
