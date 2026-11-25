#!/usr/bin/env bash
# Optional: installs and starts both servers (backend :8100, frontend :3100). Stop with Ctrl+C.
set -e
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
cd backend
[ -d .venv ] || "$PY" -m venv .venv
if [ -f .venv/bin/activate ]; then source .venv/bin/activate; else source .venv/Scripts/activate; fi
pip install -q -r requirements.txt
uvicorn main:app --reload --port 8100 &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT INT TERM
cd ../frontend
npm install --no-fund --no-audit
echo ""
echo "Open http://localhost:3100"
npm run dev
