# Kabul Map: Next.js + FastAPI

Street, satellite and satellite-with-names views of Kabul, plus a searchable list of popular places.

## Run the backend (port 8000)
    cd backend
    python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    uvicorn main:app --reload

## Run the frontend (port 3000)
    cd frontend
    cp .env.local.example .env.local                     # Windows: copy .env.local.example .env.local
    npm install
    npm run dev

Quick start: `bash run.sh` (sets up and starts both servers), or follow the steps below.

Open http://localhost:3000

## Customize
- Add or fix places in `backend/places.json` (id, name, name_fa, category, lat, lng, description). Coordinates are approximate, so check them on the map.
- Tile sources live in `backend/main.py`. OpenStreetMap and Esri tiles are fine for development; for production traffic, use a tile provider with an API key.
