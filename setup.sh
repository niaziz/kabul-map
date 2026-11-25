#!/usr/bin/env bash
# Writes the Kabul map code into ./kabul-map (overwrites the code files).
# It does NOT install anything and does NOT start any server.
set -e
mkdir -p kabul-map && cd kabul-map
rm -rf frontend/.next   # clear the old build cache so the new code shows
mkdir -p "."
cat > 'README.md' <<'KABUL_FILE_EOF'
# Kabul Map: Next.js + FastAPI

Apple Maps-style map of Kabul province only, with named place pins and Map / Satellite views. There is no sidebar; click a map pin to open its place details.
Backend: `cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000`
Frontend: `cd frontend && npm install && npm run dev` then open http://localhost:3000
KABUL_FILE_EOF
mkdir -p "backend"
cat > 'backend/main.py' <<'KABUL_FILE_EOF'
import json
import time
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Kabul Map API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",  # any local port, e.g. 3000 or 3001
    allow_methods=["GET"],
    allow_headers=["*"],
)

CACHE = Path(__file__).parent / "kabul_boundary.json"
PLACES = json.loads((Path(__file__).parent / "places.json").read_text(encoding="utf-8"))
HEADERS = {"User-Agent": "kabul-map-local-dev/1.0 (personal project)"}


def _bbox(geom):
    pts = []

    def walk(c):
        if c and isinstance(c[0], (int, float)):
            pts.append(c)
        else:
            for x in c:
                walk(x)

    walk(geom["coordinates"])
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


def _from_geoboundaries(client):
    """Province outlines of Afghanistan from geoBoundaries (static files, very reliable)."""
    meta = client.get("https://www.geoboundaries.org/api/current/gbOpen/AFG/ADM1/").json()
    if isinstance(meta, list):
        meta = meta[0]
    url = meta.get("simplifiedGeometryGeoJSON") or meta["gjDownloadURL"]
    for f in client.get(url).json()["features"]:
        if "kabul" in str(f.get("properties", {}).get("shapeName", "")).lower():
            return f["geometry"]
    raise RuntimeError("Kabul not found in the geoBoundaries file")


def _from_nominatim(client):
    """Fallback: OpenStreetMap's Nominatim search."""
    for i, params in enumerate([{"state": "Kabul", "country": "Afghanistan"}, {"q": "Kabul Province, Afghanistan"}]):
        if i:
            time.sleep(1.1)  # Nominatim allows 1 request per second
        r = client.get(
            "https://nominatim.openstreetmap.org/search",
            params={**params, "format": "jsonv2", "polygon_geojson": 1, "polygon_threshold": 0.001, "limit": 3},
        )
        r.raise_for_status()
        for item in r.json():
            g = item.get("geojson")
            if g and g["type"] in ("Polygon", "MultiPolygon") and _bbox(g)[2] - _bbox(g)[0] > 0.5:
                return g
    raise RuntimeError("Kabul province not found in Nominatim")


def _fetch_boundary():
    errors = []
    with httpx.Client(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        for source in (_from_geoboundaries, _from_nominatim):
            try:
                geom = source(client)
                bbox = _bbox(geom)
                if bbox[2] - bbox[0] > 0.5:  # province-sized, not just the city
                    return {"geometry": geom, "bbox": bbox}
                errors.append(f"{source.__name__}: outline too small")
            except Exception as e:
                errors.append(f"{source.__name__}: {type(e).__name__} {e}")
    raise RuntimeError(" | ".join(errors))


@app.get("/api/boundary")
def boundary():
    if CACHE.exists():
        return json.loads(CACHE.read_text(encoding="utf-8"))
    try:
        data = _fetch_boundary()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    CACHE.write_text(json.dumps(data), encoding="utf-8")
    return data


@app.get("/api/places")
def places(category: str | None = None):
    return [p for p in PLACES if not category or p["category"] == category]
KABUL_FILE_EOF
mkdir -p "backend"
cat > 'backend/places.json' <<'KABUL_FILE_EOF'
[
  {"id":"arg","name":"Arg (Presidential Palace)","name_fa":"ارگ ریاست جمهوری","category":"historic","lat":34.5174,"lng":69.1914,"description":"Fortified palace complex in central Kabul."},
  {"id":"darul-aman","name":"Darul Aman Palace","name_fa":"قصر دارالامان","category":"historic","lat":34.4980,"lng":69.1050,"description":"1920s palace built under King Amanullah Khan."},
  {"id":"babur-gardens","name":"Babur Gardens","name_fa":"باغ بابر","category":"leisure","lat":34.5058,"lng":69.1461,"description":"16th-century terraced gardens and the tomb of Emperor Babur."},
  {"id":"national-museum","name":"National Museum of Afghanistan","name_fa":"موزیم ملی افغانستان","category":"culture","lat":34.5010,"lng":69.1180,"description":"Afghanistan's main museum of archaeology and history."},
  {"id":"airport","name":"Hamid Karzai International Airport","name_fa":"میدان هوایی بین‌المللی حامد کرزی","category":"transport","lat":34.5659,"lng":69.2123,"description":"Kabul's international airport."},
  {"id":"shah-do-shamshira","name":"Shah-Do Shamshira Mosque","name_fa":"مسجد شاه دو شمشیره","category":"religion","lat":34.5243,"lng":69.1779,"description":"Well-known mosque in the city centre."},
  {"id":"pul-e-khishti","name":"Pul-e Khishti Mosque","name_fa":"مسجد پل خشتی","category":"religion","lat":34.5283,"lng":69.1733,"description":"Largest mosque in Kabul, on the old city side of the river."},
  {"id":"bala-hissar","name":"Bala Hissar","name_fa":"بالاحصار","category":"historic","lat":34.4975,"lng":69.1960,"description":"Ancient hilltop fortress overlooking Kabul."},
  {"id":"qargha","name":"Qargha Lake","name_fa":"دریاچه قرغه","category":"leisure","lat":34.5700,"lng":69.0450,"description":"Reservoir west of the city, popular for weekend outings."},
  {"id":"kabul-university","name":"Kabul University","name_fa":"پوهنتون کابل","category":"education","lat":34.5242,"lng":69.1400,"description":"Afghanistan's oldest and largest university."},
  {"id":"auaf","name":"American University of Afghanistan","name_fa":"پوهنتون امریکایی افغانستان","category":"education","lat":34.4950,"lng":69.0950,"description":"Private university on Darulaman Road."},
  {"id":"serena","name":"Kabul Serena Hotel","name_fa":"هوتل سرینا","category":"hotel","lat":34.5342,"lng":69.1789,"description":"Well-known hotel in the Shahr-e Naw area."},
  {"id":"chicken-street","name":"Chicken Street","name_fa":"چکن استریت","category":"shopping","lat":34.5350,"lng":69.1715,"description":"Shopping street known for carpets, crafts and antiques."},
  {"id":"shahr-e-naw-park","name":"Shahr-e Naw Park","name_fa":"پارک شهر نو","category":"leisure","lat":34.5385,"lng":69.1740,"description":"Central city park in the Shahr-e Naw district."}
]
KABUL_FILE_EOF
mkdir -p "backend"
cat > 'backend/requirements.txt' <<'KABUL_FILE_EOF'
fastapi>=0.115
uvicorn[standard]>=0.30
httpx>=0.27
KABUL_FILE_EOF
mkdir -p "frontend"
cat > 'frontend/.env.local.example' <<'KABUL_FILE_EOF'
NEXT_PUBLIC_API_URL=http://localhost:8000
KABUL_FILE_EOF
mkdir -p "frontend"
cat > 'frontend/next.config.mjs' <<'KABUL_FILE_EOF'
export default { reactStrictMode: true };
KABUL_FILE_EOF
mkdir -p "frontend"
cat > 'frontend/package.json' <<'KABUL_FILE_EOF'
{
  "name": "kabul-map-frontend",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" },
  "dependencies": {
    "maplibre-gl": "^5.0.0",
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.6.0"
  }
}
KABUL_FILE_EOF
mkdir -p "frontend"
cat > 'frontend/tsconfig.json' <<'KABUL_FILE_EOF'
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"], "allowJs": true,
    "skipLibCheck": true, "strict": true, "noEmit": true, "esModuleInterop": true,
    "module": "esnext", "moduleResolution": "bundler", "resolveJsonModule": true,
    "isolatedModules": true, "jsx": "preserve", "incremental": true,
    "plugins": [{ "name": "next" }], "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
KABUL_FILE_EOF
mkdir -p "frontend/app"
cat > 'frontend/app/globals.css' <<'KABUL_FILE_EOF'
html, body { margin:0; height:100%; color:#1c1c1e; background:#e5e3de;
  font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif; }
button { font:inherit; color:inherit; border:0; background:none; cursor:pointer; }
button:focus-visible, input:focus-visible { outline:2px solid #0a84ff; outline-offset:2px; }

.stage { position:fixed; inset:0; }
.map { width:100%; height:100%; }
.glass { background:rgba(250,250,250,.78); -webkit-backdrop-filter:blur(24px) saturate(180%); backdrop-filter:blur(24px) saturate(180%);
  border-radius:14px; box-shadow:0 0 0 .5px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.14); }

/* top-right controls */
.ctl { position:absolute; top:16px; right:16px; z-index:2; display:flex; flex-direction:column; align-items:flex-end; gap:10px; }
.seg { display:flex; gap:2px; padding:3px; border-radius:12px; }
.seg button { padding:6px 14px; border-radius:9px; font-size:13px; font-weight:500; }
.seg button.on { background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.2); }
.stack { display:flex; flex-direction:column; overflow:hidden; border-radius:12px; }
.stack button, .one { width:40px; height:40px; display:grid; place-items:center; padding:0; font-size:22px; border-radius:12px; }
.stack button { border-radius:0; }
.stack button + button { border-top:.5px solid rgba(0,0,0,.15); }
.one { color:#0a84ff; }

/* map pins with names */
.pin .dot { width:34px; height:34px; display:grid; place-items:center; border-radius:50%; background:var(--c); border:3px solid #fff; box-shadow:0 2px 6px rgba(0,0,0,.4); font-size:16px; cursor:pointer; }
.pin .lbl { display:none; position:absolute; top:100%; left:50%; transform:translateX(-50%); margin-top:4px; white-space:nowrap; padding:2px 7px; border-radius:6px; background:rgba(255,255,255,.94); font-size:12px; font-weight:600; box-shadow:0 1px 4px rgba(0,0,0,.35); pointer-events:none; }
.names .pin .lbl, .pin:hover .lbl { display:block; }
.pin:hover { z-index:5; }
.maplibregl-popup-content { padding:12px 14px; border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,.2); max-width:240px; }
.maplibregl-popup-content p { margin:6px 0 0; font-size:13px; color:#48484a; }
.maplibregl-ctrl-attrib { font-size:10px; }

.note { position:absolute; z-index:3; left:16px; right:16px; bottom:40px; max-width:460px; margin:0 auto; padding:12px 16px; font-size:14px; }

@media (max-width:800px) {
  .ctl { top:12px; right:12px; }
  .note { left:12px; right:12px; }
}
KABUL_FILE_EOF
mkdir -p "frontend/app"
cat > 'frontend/app/layout.tsx' <<'KABUL_FILE_EOF'
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Kabul", description: "Map of Kabul" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
KABUL_FILE_EOF
mkdir -p "frontend/app"
cat > 'frontend/app/page.tsx' <<'KABUL_FILE_EOF'
import MapLoader from "@/components/MapLoader";

export default function Home() {
  return <MapLoader />;
}
KABUL_FILE_EOF
mkdir -p "frontend/components"
cat > 'frontend/components/KabulMap.tsx' <<'KABUL_FILE_EOF'
"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addMask, applyMode, buildStyle, type Mode } from "@/lib/style";
import { API, getJSON, type Place } from "@/lib/api";

const KABUL: [number, number] = [69.1723, 34.5281];
const FALLBACK_BBOX = [68.75, 34.15, 69.85, 35.0]; // used only if the outline can't be loaded

const CATS: Record<string, { icon: string; color: string }> = {
  historic: { icon: "🏛️", color: "#92400e" },
  culture: { icon: "🖼️", color: "#6d28d9" },
  religion: { icon: "🕌", color: "#047857" },
  education: { icon: "🎓", color: "#1d4ed8" },
  transport: { icon: "✈️", color: "#475569" },
  leisure: { icon: "🌳", color: "#15803d" },
  shopping: { icon: "🛍️", color: "#be185d" },
  hotel: { icon: "🏨", color: "#0e7490" },
};

function popupEl(p: Place) {
  const d = document.createElement("div");
  const h = document.createElement("strong");
  h.textContent = p.name;
  d.append(h);
  if (p.name_fa) {
    const f = document.createElement("div");
    f.lang = "fa"; f.dir = "rtl"; f.textContent = p.name_fa;
    d.append(f);
  }
  const t = document.createElement("p");
  t.textContent = p.description;
  d.append(t);
  return d;
}

export default function KabulMap() {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("map");
  const [note, setNote] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [zoomedIn, setZoomedIn] = useState(false);

  useEffect(() => {
    let dead = false;
    const map = new maplibregl.Map({
      container: box.current!, style: buildStyle(), center: KABUL, zoom: 11.5,
      minZoom: 8, maxZoom: 18, dragRotate: false, attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    map.on("zoom", () => setZoomedIn(map.getZoom() >= 14));
    mapRef.current = map;

    map.on("load", async () => {
      let bbox: number[] = FALLBACK_BBOX;
      try {
        const res = await fetch(`${API}/api/boundary`);
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.detail ?? `HTTP ${res.status}`);
        }
        const b = await res.json();
        if (dead) return;
        addMask(map, b.geometry);
        bbox = b.bbox;
      } catch (e) {
        if (dead) return;
        const why = e instanceof TypeError ? `can't reach the backend at ${API}, is it running?` : (e as Error).message;
        setNote(`Kabul's outline couldn't be loaded (${why}). Other provinces may show.`);
      }
      const pad = 0.02;
      const bounds: [[number, number], [number, number]] = [[bbox[0] - pad, bbox[1] - pad], [bbox[2] + pad, bbox[3] + pad]];
      const fit = map.cameraForBounds(bounds);
      if (fit?.zoom) map.setMinZoom(fit.zoom);
      map.setMaxBounds(bounds);
      setReady(true);
    });

    return () => { dead = true; map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    getJSON<Place[]>("/api/places").then(setPlaces).catch(() =>
      setNote((n) => n || `Places couldn't be loaded. Is the backend running at ${API}?`));
  }, []);

  useEffect(() => {
    if (ready && mapRef.current) applyMode(mapRef.current, mode);
  }, [ready, mode]);

  // one marker per place
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const made = places.map((p) => {
      const c = CATS[p.category];
      const el = document.createElement("div");
      el.className = "pin";
      el.style.setProperty("--c", c?.color ?? "#333");
      const dot = document.createElement("span");
      dot.className = "dot"; dot.textContent = c?.icon ?? "📍";
      const lbl = document.createElement("span");
      lbl.className = "lbl"; lbl.textContent = p.name;
      el.append(dot, lbl);
      const popup = new maplibregl.Popup({ offset: 22, closeButton: false }).setDOMContent(popupEl(p));
      const m = new maplibregl.Marker({ element: el }).setLngLat([p.lng, p.lat]).setPopup(popup).addTo(map);
      return m;
    });
    return () => { made.forEach((m) => m.remove()); };
  }, [ready, places]);

  return (
    <div className={`stage${zoomedIn ? " names" : ""}`}>
      <div ref={box} className="map" />

      <div className="ctl">
        <div className="glass seg" role="group" aria-label="Map type">
          {(["map", "satellite"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "map" ? "Map" : "Satellite"}
            </button>
          ))}
        </div>
        <div className="glass stack">
          <button aria-label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</button>
          <button aria-label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</button>
        </div>
        <button className="glass one" aria-label="Go to Kabul city"
                onClick={() => mapRef.current?.flyTo({ center: KABUL, zoom: 11.5 })}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M3 11 21 3l-8 18-2-8z" fill="currentColor" /></svg>
        </button>
      </div>
      {note && <p className="note glass">{note}</p>}
    </div>
  );
}
KABUL_FILE_EOF
mkdir -p "frontend/components"
cat > 'frontend/components/MapLoader.tsx' <<'KABUL_FILE_EOF'
"use client";
import dynamic from "next/dynamic";

// MapLibre needs `window`, so render the map on the client only.
const KabulMap = dynamic(() => import("./KabulMap"), { ssr: false });

export default function MapLoader() {
  return <KabulMap />;
}
KABUL_FILE_EOF
mkdir -p "frontend/lib"
cat > 'frontend/lib/api.ts' <<'KABUL_FILE_EOF'
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Place = {
  id: string; name: string; name_fa?: string;
  category: string; lat: number; lng: number; description: string;
};

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
KABUL_FILE_EOF
mkdir -p "frontend/lib"
cat > 'frontend/lib/style.ts' <<'KABUL_FILE_EOF'
import type { Map as MLMap } from "maplibre-gl";

export type Mode = "map" | "satellite";

const SRC = "ofm";
const NAME = ["coalesce", ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
const ramp = (...s: number[]): any => ["interpolate", ["exponential", 1.5], ["zoom"], ...s];
const HALO = { "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.5 };
const ATTR =
  '<a href="https://openfreemap.org">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Apple Maps-like palette: warm light land, soft green parks, blue water, white roads, amber highways.
function layers(): any[] {
  const L: any[] = [];
  const base = (id: string, type: string, sl: string | null, o: any) =>
    L.push({ id, type, ...(sl ? { source: SRC, "source-layer": sl } : {}), ...o, metadata: { g: "base" } });
  const text = (id: string, sl: string, color: string, layout: any, o: any = {}) =>
    L.push({
      id, type: "symbol", source: SRC, "source-layer": sl, ...o,
      layout: { "text-field": NAME, "text-font": ["Noto Sans Regular"], "text-max-width": 7, ...layout },
      paint: { "text-color": color, ...HALO },
      metadata: { g: "label", c: color },
    });

  L.push({ id: "sat", type: "raster", source: "sat", layout: { visibility: "none" }, metadata: { g: "sat" } });
  base("bg", "background", null, { paint: { "background-color": "#f2efe9" } });
  base("landcover", "fill", "landcover", {
    paint: { "fill-color": ["match", ["get", "class"], "wood", "#cfe3b8", "grass", "#dcebc8", "wetland", "#d4e6cf", "farmland", "#ebecd8", "sand", "#f1e7cb", "#f2efe9"] },
  });
  base("park", "fill", "park", { paint: { "fill-color": "#d3e8bf", "fill-opacity": 0.85 } });
  base("landuse", "fill", "landuse", {
    filter: ["in", "class", "hospital", "school", "college", "cemetery", "industrial", "pitch", "stadium"],
    paint: { "fill-color": ["match", ["get", "class"], "hospital", "#f6e0dc", "school", "#f1ead6", "college", "#f1ead6", "cemetery", "#d6e7cb", "industrial", "#e8e5df", "#dcebc8"] },
  });
  base("water", "fill", "water", { paint: { "fill-color": "#a9d3f5" } });
  base("waterway", "line", "waterway", {
    filter: ["in", "class", "river", "canal", "stream"],
    paint: { "line-color": "#a9d3f5", "line-width": ramp(10, 0.6, 16, 4) },
  });
  base("apron", "fill", "aeroway", { filter: ["==", "$type", "Polygon"], paint: { "fill-color": "#e3dfd6" } });
  base("runway", "line", "aeroway", {
    filter: ["in", "class", "runway", "taxiway"],
    paint: { "line-color": "#ffffff", "line-width": ramp(10, 1, 16, 14) },
  });
  base("building", "fill", "building", {
    minzoom: 13,
    paint: { "fill-color": "#e7e2d9", "fill-outline-color": "#d8d2c6", "fill-opacity": ramp(13, 0, 15, 1) },
  });
  base("path", "line", "transportation", {
    minzoom: 15,
    filter: ["in", "class", "path", "pedestrian"],
    paint: { "line-color": "#cfc9bd", "line-width": 1, "line-dasharray": [2, 2] },
  });

  // [name, classes, fill, casing, width stops, minzoom]
  const roads: [string, string[], string, string, number[], number][] = [
    ["minor", ["minor", "service", "track"], "#ffffff", "#dcd7cd", [12, 0.5, 15, 3, 18, 14], 12],
    ["street", ["tertiary", "secondary"], "#ffffff", "#d3cdc1", [8, 0.5, 13, 2.5, 18, 22], 8],
    ["main", ["primary", "trunk"], "#fff1b8", "#e4c262", [6, 0.6, 13, 4, 18, 26], 6],
    ["motorway", ["motorway"], "#fdd48a", "#e3a64a", [5, 0.8, 13, 5, 18, 30], 5],
  ];
  const road = (id: string, cls: string[], color: string, w: number[], minzoom: number) =>
    base(id, "line", "transportation", {
      minzoom,
      filter: ["all", ["in", "class", ...cls], ["!=", "brunnel", "tunnel"]],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": color, "line-width": ramp(...w) },
    });
  for (const [n, cls, , cas, w, mz] of roads) road(`${n}-case`, cls, cas, w.map((v, i) => (i % 2 ? v + 1.4 : v)), mz);
  for (const [n, cls, fill, , w, mz] of roads) road(n, cls, fill, w, mz);

  // ---- labels: every named place, road, water body and point of interest in the tiles ----
  text("water-name", "water_name", "#4f8fc0", { "text-font": ["Noto Sans Italic"], "text-size": 12 });
  text("road-name", "transportation_name", "#6e6e73", {
    "symbol-placement": "line", "text-max-angle": 30, "text-size": ramp(13, 10, 18, 13),
  }, { minzoom: 13 });
  const places: [string, string[], number, any, boolean, string][] = [
    ["city", ["city"], 5, ramp(5, 13, 12, 24), true, "#1c1c1e"],
    ["town", ["town"], 8, ramp(8, 12, 14, 18), true, "#1c1c1e"],
    ["village", ["village", "hamlet", "isolated_settlement"], 11, ramp(11, 11, 15, 14), false, "#3a3a3c"],
    ["suburb", ["suburb", "quarter", "neighbourhood"], 12, ramp(12, 11, 16, 15), false, "#6e6e73"],
  ];
  for (const [n, cls, mz, size, bold, col] of places)
    text(`place-${n}`, "place", col, { "text-size": size, ...(bold ? { "text-font": ["Noto Sans Bold"] } : {}) }, {
      minzoom: mz, filter: ["in", "class", ...cls],
    });
  text("airport", "aerodrome_label", "#475569", { "text-font": ["Noto Sans Bold"], "text-size": 12 }, { minzoom: 9 });

  const dot = ["match", ["get", "class"], "hospital", "#ff6b6b", "school", "#5b8def", "college", "#5b8def", "place_of_worship", "#2fa37a", "park", "#4cb86b", "lodging", "#e8913a", "restaurant", "#f08a4b", "cafe", "#f08a4b", "shop", "#4ba3ff", "stadium", "#4cb86b", "#8e8e93"];
  const rank: any = ["coalesce", ["get", "rank"], 99];
  const pois: [string, any, number][] = [["poi", ["<=", rank, 10], 13], ["poi-minor", [">", rank, 10], 16]];
  for (const [id, filter, minzoom] of pois) {
    L.push({
      id: `${id}-dot`, type: "circle", source: SRC, "source-layer": "poi", minzoom, filter,
      paint: { "circle-color": dot, "circle-radius": ramp(13, 3, 18, 7), "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 },
    });
    text(id, "poi", "#3a3a3c", {
      "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.8], "text-optional": true, "symbol-sort-key": ["get", "rank"],
    }, { minzoom, filter });
  }
  return L;
}

export const buildStyle = (): any => ({
  version: 8,
  glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
  sources: {
    [SRC]: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: ATTR },
    sat: {
      type: "raster", tileSize: 256, maxzoom: 18, attribution: "Imagery &copy; Esri, Maxar",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    },
  },
  layers: layers(),
});

// Everything outside the Kabul outline is covered, so no other province is visible.
export function addMask(map: MLMap, geom: any) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const holes = polys.map((p: number[][][]) => p[0]);
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  map.addSource("kabul", { type: "geojson", data: { type: "Feature", properties: {}, geometry: geom } });
  map.addSource("mask", {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } },
  });
  map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#e5e3de", "fill-opacity": 1 } });
  map.addLayer({ id: "kabul-line", type: "line", source: "kabul", paint: { "line-color": "#8e8e93", "line-width": 1.2, "line-opacity": 0.7 } });
}

export function applyMode(map: MLMap, mode: Mode) {
  const sat = mode === "satellite";
  for (const l of map.getStyle().layers) {
    const m: any = (l as any).metadata;
    if (m?.g === "base") map.setLayoutProperty(l.id, "visibility", sat ? "none" : "visible");
    if (m?.g === "sat") map.setLayoutProperty(l.id, "visibility", sat ? "visible" : "none");
    if (m?.g === "label") {
      map.setPaintProperty(l.id, "text-color", sat ? "#ffffff" : m.c);
      map.setPaintProperty(l.id, "text-halo-color", sat ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.9)");
    }
  }
  if (map.getLayer("mask")) map.setPaintProperty("mask", "fill-color", sat ? "#1c1c1e" : "#e5e3de");
}
KABUL_FILE_EOF

cat <<'MSG'

Done. The code is in ./kabul-map (no servers were started).

When you want to run it (stop any old servers first):
  cd kabul-map/backend  && pip install -r requirements.txt && uvicorn main:app --reload --port 8000
  cd kabul-map/frontend && npm install && npm run dev
MSG

