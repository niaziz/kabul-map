import type { Map as MLMap } from "maplibre-gl";

export type Mode = "map" | "satellite";

const SRC = "ofm";
const NAME = ["coalesce", ["get", "name:fa"], ["get", "name"], ["get", "name_en"], ["get", "name:latin"]];
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
    paint: {
      "fill-color": "#e7e2d9",
      "fill-outline-color": "#d8d2c6",
      "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, 0.7, 15, 0.25, 16, 0],
    },
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

  L.push({
    id: "building-outline", type: "line", source: SRC, "source-layer": "building", minzoom: 14,
    layout: { visibility: "none" },
    paint: { "line-color": "#2d3454", "line-width": ramp(14, 0.4, 18, 1.4), "line-opacity": 0.85 },
  });
  L.push({
    id: "building-3d",
    type: "fill-extrusion",
    source: SRC,
    "source-layer": "building",
    minzoom: 15,
    filter: ["!=", ["get", "hide_3d"], true],
    layout: { visibility: "none" },
    paint: {
      "fill-extrusion-color": [
        "coalesce",
        ["get", "colour"],
        [
          "match",
          ["%", ["coalesce", ["id"], ["get", "render_height"], 0], 8],
          0, "#e8cdb2",
          1, "#d5d9c8",
          2, "#c8d8e8",
          3, "#e7c7c4",
          4, "#e4d7b6",
          5, "#d3c8e5",
          6, "#c8ddd6",
          "#e7e2d9",
        ],
      ],
      "fill-extrusion-height": ["max", 3, ["coalesce", ["get", "render_height"], 5]],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.94,
      "fill-extrusion-vertical-gradient": true,
    },
  });

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

  const rank: any = ["coalesce", ["get", "rank"], 99];
  const pois: [string, any, number][] = [["poi", ["<=", rank, 10], 13], ["poi-minor", [">", rank, 10], 16]];
  for (const [id, filter, minzoom] of pois) {
    text(id, "poi", "#3a3a3c", {
      "text-size": 11, "text-anchor": "top", "text-offset": [0, 0.8], "text-optional": true, "symbol-sort-key": ["get", "rank"],
    }, { minzoom, filter });
  }
  return L;
}

export const buildStyle = (): any => ({
  version: 8,
  light: {
    anchor: "viewport",
    color: "#fff3df",
    intensity: 0.72,
    position: [1.15, 215, 42],
  },
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
