#!/usr/bin/env bash
# Splice src/engine.js into src/app.js (between the engine markers), syntax-check, then build dist/.
set -e
cd "$(dirname "$0")/.."
python3 - <<'PY'
a=open('src/app.js').read(); e=open('src/engine.js').read()
A="/* ---------- graph engine (canvas, 2D + 3D) ---------- */"; B="/* ---------- views ---------- */"
i=a.index(A); j=a.index(B)
open('src/app.js','w').write(a[:i]+e.rstrip()+"\n\n"+a[j:])
PY
node -e "new Function(require('fs').readFileSync('src/app.js','utf8'))"
python3 tools/build.py
