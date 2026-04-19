#!/usr/bin/env bash
# Build su Render (Linux): evita comandi npm spezzati nel dashboard e riduce OOM sul CRA.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Install dipendenze root..."
npm install --no-audit --no-fund

echo "==> Install dipendenze server/..."
npm install --prefix server --no-audit --no-fund

echo "==> Build frontend (CRA, usa .env.production)..."
export NODE_OPTIONS="--max-old-space-size=3072"
export GENERATE_SOURCEMAP=false
export DISABLE_ESLINT_PLUGIN=true
export INLINE_RUNTIME_CHUNK=false

npm run build

echo "==> Verifica build..."
if [ ! -d "build" ]; then
    echo "ERRORE: Directory build non creata!"
    exit 1
fi

if [ ! -f "build/index.html" ]; then
    echo "ERRORE: index.html non trovato in build/"
    ls -la build/
    exit 1
fi

echo "==> Build completata con successo."
echo "==> Contenuto directory build:"
ls -la build/
echo "==> Contenuto build/static:"
ls -la build/static/ || echo "Nessuna directory static/"
