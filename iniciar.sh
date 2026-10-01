#!/bin/sh
# Inicia o site de etiquetas (Linux/macOS).
cd "$(dirname "$0")" || exit 1
exec node server.js
