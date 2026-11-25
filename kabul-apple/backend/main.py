import html
import json
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

app = FastAPI(title="Kabul Map API")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",  # any local port, e.g. 3000 or 3001
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

CACHE = Path(__file__).parent / "kabul_boundary.json"
PLACES = json.loads((Path(__file__).parent / "places.json").read_text(encoding="utf-8"))
PLAN_CACHE = Path(__file__).parent / "street_plans.json"
DISTRICT_CACHE = Path(__file__).parent / "district_plans.json"
PLAN_URLS = {
    "streetPlans": "https://kmplan.km.gov.af/plans_file/2b906ac4-d3a0-47c3-81eb-d2de4b7f72f5.kmz",
    "permittedBuildings": "https://kmplan.km.gov.af/plans_file/835734bb-8cee-4c98-a1c8-e31513409587.kmz",
}
DISTRICT_PLAN_URLS = {
    9: "https://kmplan.km.gov.af/plans_file/0dfd2b29-2911-4fef-8a22-094a8b54b888.kmz",
    10: "https://kmplan.km.gov.af/plans_file/2d61a889-ee8e-41fd-b088-caaef927cacb.kmz",
    11: "https://kmplan.km.gov.af/plans_file/699560d7-3139-4a97-be47-8dc7c11997ca.kmz",
    12: "https://kmplan.km.gov.af/plans_file/65bd0fc3-775a-4d0b-93b8-5bc9f41c1e4b.kmz",
    13: "https://kmplan.km.gov.af/plans_file/507834c3-b200-4ec5-aaf7-c46863e32535.kmz",
    14: "https://kmplan.km.gov.af/plans_file/8b202166-2723-4ba1-b47c-1393ad6aeade.kmz",
    15: "https://kmplan.km.gov.af/plans_file/0b550a88-17db-44e1-b0ba-91ef243e6a7e.kmz",
    16: "https://kmplan.km.gov.af/plans_file/0993042a-1e67-421d-abb1-f21a74a7a5cf.kmz",
    17: "https://kmplan.km.gov.af/plans_file/661da116-cd16-4080-b32d-7852c6a61cb7.kmz",
    18: "https://kmplan.km.gov.af/plans_file/d1de4168-2fae-4887-9f73-73954f086ac4.kmz",
    19: "https://kmplan.km.gov.af/plans_file/09a8462c-e32c-4fae-9d95-2f3e41a6c663.kmz",
    20: "https://kmplan.km.gov.af/plans_file/b92112dc-daa9-4c06-b15e-ff57dda3d2cd.kmz",
    21: "https://kmplan.km.gov.af/plans_file/6a70ffed-05f1-41da-b8a9-c3728e01693f.kmz",
    22: "https://kmplan.km.gov.af/plans_file/afad398c-4730-41bf-a942-f36203717a9e.kmz",
}
KML = "{http://www.opengis.net/kml/2.2}"
HEADERS = {"User-Agent": "kabul-map-local-dev/1.0 (personal project)"}


class _TableCells(HTMLParser):
    def __init__(self):
        super().__init__()
        self.cells = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "td":
            self.current = []

    def handle_data(self, data):
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "td" and self.current is not None:
            self.cells.append(" ".join(" ".join(self.current).split()))
            self.current = None


def _geometry(element):
    kind = element.tag.removeprefix(KML)
    if kind in ("LineString", "Point"):
        text = element.findtext(f"{KML}coordinates", default="")
        coordinates = [
            [float(value) for value in position.split(",")[:2]]
            for position in text.split()
        ]
        if not coordinates:
            return None
        if kind == "Point":
            return {"type": kind, "coordinates": coordinates[0]}
        return {"type": kind, "coordinates": coordinates}

    if kind == "Polygon":
        rings = []
        for boundary in ("outerBoundaryIs", "innerBoundaryIs"):
            for node in element.findall(f".//{KML}{boundary}/{KML}LinearRing/{KML}coordinates"):
                ring = [
                    [float(value) for value in position.split(",")[:2]]
                    for position in (node.text or "").split()
                ]
                if ring:
                    rings.append(ring)
        return {"type": kind, "coordinates": rings} if rings else None

    if kind == "MultiGeometry":
        geometries = [g for child in element for g in [_geometry(child)] if g]
        if not geometries:
            return None
        kinds = {g["type"] for g in geometries}
        multi_type = {"LineString": "MultiLineString", "Point": "MultiPoint", "Polygon": "MultiPolygon"}
        if len(kinds) == 1 and next(iter(kinds)) in multi_type:
            return {
                "type": multi_type[next(iter(kinds))],
                "coordinates": [g["coordinates"] for g in geometries],
            }
        return {"type": "GeometryCollection", "geometries": geometries}

    return None


def _kml_styles(root):
    styles = {}
    for style in root.findall(f".//{KML}Style"):
        line = style.find(f"{KML}LineStyle")
        polygon = style.find(f"{KML}PolyStyle")
        if (line is None and polygon is None) or not style.get("id"):
            continue
        properties = {}
        if line is not None:
            color = line.findtext(f"{KML}color", default="")
            if re.fullmatch(r"[0-9a-fA-F]{8}", color):
                alpha, blue, green, red = (color[i:i + 2] for i in (0, 2, 4, 6))
                properties.update(line_color=f"#{red}{green}{blue}", line_opacity=int(alpha, 16) / 255)
        if polygon is not None:
            color = polygon.findtext(f"{KML}color", default="")
            if re.fullmatch(r"[0-9a-fA-F]{8}", color):
                alpha, blue, green, red = (color[i:i + 2] for i in (0, 2, 4, 6))
                fill_opacity = int(alpha, 16) / 255
                if polygon.findtext(f"{KML}fill", default="1") == "0":
                    fill_opacity = 0
                properties.update(fill_color=f"#{red}{green}{blue}", fill_opacity=fill_opacity)
            if line is not None and line.findtext(f"{KML}color"):
                properties["outline_color"] = properties.get("line_color", "#6e6e6e")
        styles[f"#{style.get('id')}"] = properties
    return styles


def _plan_features(client, url):
    response = client.get(url)
    response.raise_for_status()
    if len(response.content) > 8 * 1024 * 1024:
        raise ValueError("official plan archive exceeds the download size limit")

    with zipfile.ZipFile(BytesIO(response.content)) as archive:
        kml_name = next((name for name in archive.namelist() if name.lower().endswith(".kml")), None)
        if not kml_name:
            raise ValueError("official plan archive contains no KML file")
        if archive.getinfo(kml_name).file_size > 32 * 1024 * 1024:
            raise ValueError("official plan KML exceeds the parsing size limit")
        root = ET.fromstring(archive.read(kml_name))

    styles = _kml_styles(root)
    features = []
    for placemark in root.findall(f".//{KML}Placemark"):
        geometry = next(
            (g for child in placemark if (g := _geometry(child)) is not None),
            None,
        )
        if geometry is None:
            continue

        description = placemark.findtext(f"{KML}description", default="")
        cells = _TableCells()
        cells.feed(html.unescape(description))
        fields = {
            key: cells.cells[i + 1]
            for i, key in enumerate(cells.cells[:-1])
            if key in {"Category", "Road_Type", "ROW_m", "Name", "Land_Use"}
        }
        style_url = placemark.findtext(f"{KML}styleUrl", default="")
        style = styles.get(style_url, {})
        row_width = fields.get("ROW_m", "")
        try:
            row_width = float(row_width) if row_width else None
        except ValueError:
            row_width = None

        features.append({
            "type": "Feature",
            "id": placemark.get("id"),
            "geometry": geometry,
            "properties": {
                "name": placemark.findtext(f"{KML}name", default="").strip(),
                "category": fields.get("Category", ""),
                "road_type": fields.get("Road_Type", ""),
                "row_m": row_width,
                "land_use": fields.get("Land_Use", ""),
                **style,
            },
        })

    return {"type": "FeatureCollection", "features": features}


def _fetch_street_plans():
    with httpx.Client(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        return {key: _plan_features(client, url) for key, url in PLAN_URLS.items()}


def _fetch_district_plans():
    with httpx.Client(headers=HEADERS, timeout=60, follow_redirects=True) as client:
        with ThreadPoolExecutor(max_workers=5) as executor:
            district_plans = executor.map(
                lambda item: (item[0], _plan_features(client, item[1])),
                DISTRICT_PLAN_URLS.items(),
            )
            features = []
            for district_id, collection in district_plans:
                for feature in collection["features"]:
                    feature["properties"]["district_id"] = district_id
                    features.append(feature)
        return {
            "type": "FeatureCollection",
            "features": features,
            "districts": list(DISTRICT_PLAN_URLS),
        }


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


@app.get("/api/street-plans")
def street_plans():
    if PLAN_CACHE.exists():
        cached = json.loads(PLAN_CACHE.read_text(encoding="utf-8"))
        if all(key in cached for key in PLAN_URLS):
            return {key: cached[key] for key in PLAN_URLS}
    try:
        data = _fetch_street_plans()
        PLAN_CACHE.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Official street plans unavailable: {type(e).__name__}: {e}")
    return data


@app.get("/api/district-plans")
def district_plans():
    if DISTRICT_CACHE.exists():
        cached = json.loads(DISTRICT_CACHE.read_text(encoding="utf-8"))
        if cached.get("districts") == list(DISTRICT_PLAN_URLS):
            return cached
    try:
        data = _fetch_district_plans()
        DISTRICT_CACHE.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False), encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"District zoning plans unavailable: {type(e).__name__}: {e}")
    return data
