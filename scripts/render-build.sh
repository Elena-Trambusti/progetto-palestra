#!/usr/bin/env bash
# Build su Render — forza devDeps per react-scripts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
echo "[BUILD] ROOT=$ROOT  pwd=$(pwd)"

# ── 1. Dipendenze root (DEVE includere devDeps per react-scripts) ──
export NODE_ENV=development
echo "[BUILD] 1/4 npm install root (NODE_ENV=$NODE_ENV) ..."
npm install --include=dev --no-audit --no-fund
echo "[BUILD]     react-scripts: $(node_modules/.bin/react-scripts --version 2>/dev/null || echo 'NOT FOUND')"

# ── 2. Dipendenze server ──
echo "[BUILD] 2/4 npm install server ..."
npm install --prefix server --no-audit --no-fund

# ── 3. Build frontend ──
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=3072"
export GENERATE_SOURCEMAP=false
export DISABLE_ESLINT_PLUGIN=true
export INLINE_RUNTIME_CHUNK=false

echo "[BUILD] 3/4 react-scripts build ..."
node_modules/.bin/react-scripts build

# ── 4. Verifica ──
if [ ! -f "build/index.html" ]; then
  echo "[BUILD] ERRORE: build/index.html non trovato!"
  ls -la build/ 2>/dev/null || echo "(nessuna cartella build)"
  exit 1
fi
echo "[BUILD] 4/4 OK — build/index.html presente"
ls -la build/
