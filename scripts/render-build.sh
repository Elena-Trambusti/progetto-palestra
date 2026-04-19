#!/usr/bin/env bash
# Build su Render (Linux): evita comandi npm spezzati nel dashboard e riduce OOM sul CRA.
# TRIGGER REBUILD: 2026-04-19-1634 - fix static files issue
set -euo pipefail

echo "[BUILD] ==========================================="
echo "[BUILD] Script di build avviato"
echo "[BUILD] Working directory: $(pwd)"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "[BUILD] ROOT directory: $ROOT"
cd "$ROOT"

echo "[BUILD] Cambiato directory in: $(pwd)"

echo "[BUILD] ==> Install dipendenze root..."
npm install --no-audit --no-fund || { echo "[BUILD] ERRORE: npm install root fallito"; exit 1; }

echo "[BUILD] ==> Install dipendenze server/..."
npm install --prefix server --no-audit --no-fund || { echo "[BUILD] ERRORE: npm install server fallito"; exit 1; }

echo "[BUILD] ==> Build frontend (CRA, usa .env.production)..."
echo "[BUILD] Node version: $(node --version)"
echo "[BUILD] NPM version: $(npm --version)"

export NODE_OPTIONS="--max-old-space-size=3072"
export GENERATE_SOURCEMAP=false
export DISABLE_ESLINT_PLUGIN=true
export INLINE_RUNTIME_CHUNK=false

echo "[BUILD] Directory prima del build:"
ls -la | head -20

npm run build 2>&1 || { echo "[BUILD] ERRORE: npm run build fallito"; exit 1; }

echo "[BUILD] ==> Verifica build..."
echo "[BUILD] Directory dopo il build:"
ls -la | head -20

if [ ! -d "build" ]; then
    echo "[BUILD] ERRORE CRITICO: Directory build non creata!"
    echo "[BUILD] Contenuto directory attuale:"
    ls -la
    exit 1
fi

if [ ! -f "build/index.html" ]; then
    echo "[BUILD] ERRORE CRITICO: index.html non trovato in build/"
    echo "[BUILD] Contenuto build/:"
    ls -la build/
    exit 1
fi

echo "[BUILD] ==> Build completata con SUCCESSO!"
echo "[BUILD] Contenuto build/:"
ls -la build/
echo "[BUILD] Contenuto build/static/:"
ls -la build/static/ 2>/dev/null || echo "[BUILD] Nessuna directory static/"
echo "[BUILD] ==========================================="
