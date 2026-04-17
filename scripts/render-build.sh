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
npm run build

echo "==> Build completata."
