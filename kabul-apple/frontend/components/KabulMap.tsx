"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { type Map as MLMap, type MapLayerMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { addMask, applyMode, buildStyle, type Mode } from "@/lib/style";
import { API, getJSON, type Place } from "@/lib/api";

const KABUL: [number, number] = [69.1723, 34.5281];
const FALLBACK_BBOX = [68.75, 34.15, 69.85, 35.0]; // used only if the outline can't be loaded
const PLAN_SOURCE = "street-plans";
const BUILDING_SOURCE = "permitted-buildings";
const DISTRICT_SOURCE = "district-zoning";
const PLACES_SOURCE = "kabul-places";
const PLACE_LAYER_IDS = [
  "place-clusters",
  "place-cluster-count",
  "place-marker-shadow",
  "place-markers",
  "place-labels",
];

type PlanGeometry =
  | { type: "LineString"; coordinates: number[][] }
  | { type: "MultiLineString"; coordinates: number[][][] }
  | { type: "Point"; coordinates: number[] }
  | { type: "MultiPoint"; coordinates: number[][] }
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }
  | { type: "GeometryCollection"; geometries: PlanGeometry[] };
type PlanFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string;
    geometry: PlanGeometry;
    properties: Record<string, string | number | null>;
  }>;
};
type PlanData = {
  streetPlans: PlanFeatureCollection;
  permittedBuildings: PlanFeatureCollection;
};
type DistrictPlanCollection = PlanFeatureCollection & { districts: number[] };

export default function KabulMap() {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>("map");
  const [buildings3dVisible, setBuildings3dVisible] = useState(false);
  const [placesVisible, setPlacesVisible] = useState(true);
  const [note, setNote] = useState("");
  const [streetPlansVisible, setStreetPlansVisible] = useState(true);
  const [permittedBuildingsVisible, setPermittedBuildingsVisible] = useState(false);
  const [districtPlansVisible, setDistrictPlansVisible] = useState(false);
  const [placesLayerReady, setPlacesLayerReady] = useState(false);
  const [placeCount, setPlaceCount] = useState(0);
  const [planLayersReady, setPlanLayersReady] = useState(false);
  const [districtLayerReady, setDistrictLayerReady] = useState(false);

  useEffect(() => {
    let dead = false;
    const map = new maplibregl.Map({
      container: box.current!, style: buildStyle(), center: KABUL, zoom: 11.5,
      minZoom: 8, maxZoom: 18, dragRotate: false, attributionControl: false,
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
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
    if (ready && mapRef.current) applyMode(mapRef.current, mode);
  }, [ready, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty("building-3d", "visibility", buildings3dVisible ? "visible" : "none");
    for (const id of ["poi", "poi-minor", "road-name"]) {
      if (map.getLayer(id))
        map.setLayoutProperty(id, "visibility", buildings3dVisible ? "none" : "visible");
    }
    map.easeTo({
      pitch: buildings3dVisible ? 58 : 0,
      bearing: buildings3dVisible ? -35 : 0,
      ...(buildings3dVisible ? { zoom: Math.max(map.getZoom(), 15) } : {}),
      duration: 850,
    });
  }, [ready, buildings3dVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let dead = false;

    getJSON<Place[]>("/api/places").then((places) => {
      if (dead) return;
      const data = {
        type: "FeatureCollection" as const,
        features: places.map((place) => ({
          type: "Feature" as const,
          geometry: { type: "Point" as const, coordinates: [place.lng, place.lat] },
          properties: place,
        })),
      };
      map.addSource(PLACES_SOURCE, {
        type: "geojson",
        data,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 42,
      });
      map.addLayer({
        id: "place-clusters",
        type: "circle",
        source: PLACES_SOURCE,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#f0a36f",
          "circle-radius": ["step", ["get", "point_count"], 15, 5, 19, 15, 23, 30, 28],
          "circle-stroke-color": "#fff9ec",
          "circle-stroke-width": 2.5,
          "circle-translate": [0, 2],
          "circle-translate-anchor": "viewport",
        },
      });
      map.addLayer({
        id: "place-cluster-count",
        type: "symbol",
        source: PLACES_SOURCE,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#4c382d",
          "text-halo-color": "#fff9ec",
          "text-halo-width": 1,
        },
      });
      map.addLayer({
        id: "place-marker-shadow",
        type: "circle",
        source: PLACES_SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "rgba(32, 27, 24, 0.28)",
          "circle-radius": 8,
          "circle-translate": [0, 3],
          "circle-translate-anchor": "viewport",
        },
      });
      map.addLayer({
        id: "place-markers",
        type: "circle",
        source: PLACES_SOURCE,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": [
            "match",
            ["get", "category"],
            "landmark", "#e98f62",
            "museum", "#a58ad2",
            "religious", "#d4ae55",
            "leisure", "#6db68a",
            "viewpoint", "#62aeb3",
            "market", "#e2a04f",
            "shopping", "#dc8b67",
            "restaurant", "#e6868f",
            "sports", "#7d9bd0",
            "entertainment", "#cc83ad",
            "hotel", "#698fce",
            "#e98f62",
          ],
          "circle-radius": 6.5,
          "circle-stroke-color": "#fff9ec",
          "circle-stroke-width": 2,
          "circle-pitch-alignment": "viewport",
          "circle-pitch-scale": "viewport",
        },
      });
      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: PLACES_SOURCE,
        minzoom: 13,
        filter: ["!", ["has", "point_count"]],
        layout: {
          "text-field": ["coalesce", ["get", "name_fa"], ["get", "name"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 16, 13],
          "text-anchor": "top",
          "text-offset": [0, 1],
          "text-padding": 3,
          "text-max-width": 10,
          "text-optional": true,
          "text-pitch-alignment": "viewport",
        },
        paint: {
          "text-color": "#44362c",
          "text-halo-color": "#fff9ec",
          "text-halo-width": 3,
          "text-halo-blur": 0.35,
        },
      });

      const onClusterClick = (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const [lng, lat] = feature.geometry.coordinates;
        map.easeTo({ center: [lng, lat], zoom: Math.min(map.getZoom() + 2, 17), duration: 500 });
      };
      const onPlaceClick = (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== "Point") return;
        const properties = feature.properties as Record<string, unknown>;
        const content = document.createElement("article");
        content.className = "place-popup";
        const heading = document.createElement("strong");
        heading.textContent = String(properties.name_fa || properties.name || "Kabul place");
        content.append(heading);

        if (typeof properties.description === "string" && properties.description) {
          const description = document.createElement("p");
          description.textContent = properties.description;
          content.append(description);
        }
        if (typeof properties.imageUrl === "string") {
          const image = document.createElement("img");
          image.className = "place-photo";
          image.src = properties.imageUrl;
          image.alt = String(properties.name || "Place in Kabul");
          image.loading = "lazy";
          content.append(image);
          if (typeof properties.imageCredit === "string") {
            const credit = document.createElement("small");
            credit.className = "place-credit";
            credit.textContent = properties.imageCredit;
            content.append(credit);
          }
          if (typeof properties.imageSourceUrl === "string") {
            const source = document.createElement("a");
            source.href = properties.imageSourceUrl;
            source.target = "_blank";
            source.rel = "noreferrer";
            source.textContent = "Photo source and license";
            content.append(source);
          }
        } else {
          const photos = document.createElement("a");
          photos.href = `https://commons.wikimedia.org/wiki/Special:MediaSearch?type=image&search=${encodeURIComponent(String(properties.name || "Kabul"))}`;
          photos.target = "_blank";
          photos.rel = "noreferrer";
          photos.textContent = "Find reference photos";
          content.append(photos);
        }
        if (typeof properties.modelEmbedUrl === "string") {
          const model = document.createElement("iframe");
          model.className = "place-model";
          model.src = properties.modelEmbedUrl;
          model.title = `3D model of ${String(properties.name || "Kabul place")}`;
          model.allow = "autoplay; fullscreen; xr-spatial-tracking";
          model.allowFullscreen = true;
          content.append(model);
          if (typeof properties.modelCredit === "string") {
            const credit = document.createElement("small");
            credit.className = "place-credit";
            credit.textContent = `3D model: ${properties.modelCredit}`;
            content.append(credit);
          }
          if (typeof properties.modelUrl === "string") {
            const link = document.createElement("a");
            link.href = properties.modelUrl;
            link.target = "_blank";
            link.rel = "noreferrer";
            link.textContent = "Open model source";
            content.append(link);
          }
        }
        const source = document.createElement("small");
        source.className = "place-source";
        source.textContent = `Coordinates: ${String(properties.source || "OpenStreetMap")}`;
        content.append(source);

        new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px" })
          .setLngLat(event.lngLat)
          .setDOMContent(content)
          .addTo(map);
      };
      const onPlaceEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onPlaceLeave = () => { map.getCanvas().style.cursor = ""; };
      map.on("click", "place-clusters", onClusterClick);
      map.on("click", "place-markers", onPlaceClick);
      map.on("mouseenter", "place-clusters", onPlaceEnter);
      map.on("mouseleave", "place-clusters", onPlaceLeave);
      map.on("mouseenter", "place-markers", onPlaceEnter);
      map.on("mouseleave", "place-markers", onPlaceLeave);
      setPlaceCount(places.length);
      setPlacesLayerReady(true);
    }).catch((error: unknown) => {
      if (dead) return;
      const detail = error instanceof Error ? error.message : String(error);
      setNote((current) => current || `Kabul places could not be loaded: ${detail}`);
    });

    return () => { dead = true; };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let dead = false;

    getJSON<PlanData>("/api/street-plans").then((data) => {
      if (dead) return;
      const before = map.getLayer("kabul-line") ? "kabul-line" : undefined;
      map.addSource(PLAN_SOURCE, { type: "geojson", data: data.streetPlans });
      map.addSource(BUILDING_SOURCE, { type: "geojson", data: data.permittedBuildings });
      map.addLayer({
        id: "permitted-buildings",
        type: "fill",
        source: BUILDING_SOURCE,
        paint: { "fill-color": "#f97316", "fill-opacity": 0.45, "fill-outline-color": "#7c2d12" },
      }, before);
      map.addLayer({
        id: "street-plan-casing",
        type: "line",
        source: PLAN_SOURCE,
        layout: { visibility: streetPlansVisible ? "visible" : "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#1c1c1e",
          "line-opacity": 0.35,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 18, 5],
        },
      }, before);
      map.addLayer({
        id: "street-plan-lines",
        type: "line",
        source: PLAN_SOURCE,
        layout: { visibility: streetPlansVisible ? "visible" : "none", "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["coalesce", ["get", "line_color"], "#d97706"],
          "line-opacity": ["coalesce", ["get", "line_opacity"], 0.9],
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 1.8, 18, 3.5],
        },
      }, before);
      setPlanLayersReady(true);
    }).catch((error: unknown) => {
      if (dead) return;
      const detail = error instanceof Error ? error.message : String(error);
      setNote((current) => current || `Official street plans could not be loaded: ${detail}`);
    });

    return () => { dead = true; };
  }, [ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !districtPlansVisible || districtLayerReady) return;
    let dead = false;

    getJSON<DistrictPlanCollection>("/api/district-plans").then((data) => {
      if (dead) return;
      const before = map.getLayer("kabul-line") ? "kabul-line" : undefined;
      map.addSource(DISTRICT_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: "district-zoning",
        type: "fill",
        source: DISTRICT_SOURCE,
        paint: {
          "fill-color": ["coalesce", ["get", "fill_color"], "#8b5cf6"],
          "fill-opacity": ["*", ["coalesce", ["get", "fill_opacity"], 1], 0.34],
          "fill-outline-color": ["coalesce", ["get", "outline_color"], "#475569"],
        },
      }, before);
      const onDistrictClick = (event: MapLayerMouseEvent) => {
        const properties = event.features?.[0]?.properties;
        if (!properties) return;
        const content = document.createElement("div");
        const heading = document.createElement("strong");
        const district = properties.district_id ? ` · District ${properties.district_id}` : "";
        heading.textContent = `${String(properties.land_use || properties.name || "Zoning")}${district}`;
        content.append(heading);
        const detail = document.createElement("p");
        detail.textContent = "Kabul Municipality zoning plan";
        content.append(detail);
        new maplibregl.Popup({ closeButton: true, closeOnClick: true })
          .setLngLat(event.lngLat)
          .setDOMContent(content)
          .addTo(map);
      };
      const onDistrictEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onDistrictLeave = () => { map.getCanvas().style.cursor = ""; };
      map.on("click", "district-zoning", onDistrictClick);
      map.on("mouseenter", "district-zoning", onDistrictEnter);
      map.on("mouseleave", "district-zoning", onDistrictLeave);
      setDistrictLayerReady(true);
    }).catch((error: unknown) => {
      if (dead) return;
      const detail = error instanceof Error ? error.message : String(error);
      setNote((current) => current || `District zoning plans could not be loaded: ${detail}`);
    });

    return () => { dead = true; };
  }, [ready, districtPlansVisible, districtLayerReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (planLayersReady) {
      map.setLayoutProperty("street-plan-casing", "visibility", streetPlansVisible ? "visible" : "none");
      map.setLayoutProperty("street-plan-lines", "visibility", streetPlansVisible ? "visible" : "none");
      map.setLayoutProperty("permitted-buildings", "visibility", permittedBuildingsVisible ? "visible" : "none");
    }
    if (districtLayerReady)
      map.setLayoutProperty("district-zoning", "visibility", districtPlansVisible ? "visible" : "none");
  }, [planLayersReady, districtLayerReady, streetPlansVisible, permittedBuildingsVisible, districtPlansVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placesLayerReady) return;
    for (const id of PLACE_LAYER_IDS)
      map.setLayoutProperty(id, "visibility", placesVisible ? "visible" : "none");
  }, [placesLayerReady, placesVisible]);

  return (
    <div className="stage">
      <div ref={box} className="map" />

      <div className="ctl">
        <div className="glass seg" role="group" aria-label="Map type">
          {(["map", "satellite"] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
              {m === "map" ? "Map" : "Satellite"}
            </button>
          ))}
        </div>
        <div className="glass plan-controls" aria-label="Map overlays">
          <label>
            <input type="checkbox" checked={buildings3dVisible} onChange={(e) => setBuildings3dVisible(e.target.checked)} />
            Isometric 3D city
          </label>
          <label>
            <input type="checkbox" checked={placesVisible} onChange={(e) => setPlacesVisible(e.target.checked)} />
            Places & labels
          </label>
          <label>
            <input type="checkbox" checked={streetPlansVisible} onChange={(e) => setStreetPlansVisible(e.target.checked)} />
            Proposed streets
          </label>
          <label>
            <input type="checkbox" checked={permittedBuildingsVisible} onChange={(e) => setPermittedBuildingsVisible(e.target.checked)} />
            Permitted building
          </label>
          <label>
            <input type="checkbox" checked={districtPlansVisible} onChange={(e) => setDistrictPlansVisible(e.target.checked)} />
            All available district zoning
          </label>
          <small>
            <a href="https://kmplan.km.gov.af/show_street_plans" target="_blank" rel="noreferrer">Kabul Municipality</a>
            {" · Indicative plan"}
          </small>
          <small>
            <a href="https://kmplan.km.gov.af/show_plans_by_district/9" target="_blank" rel="noreferrer">District zoning source</a>
            {" · Plans published for districts 9–22"}
          </small>
          {placesLayerReady && <small>{placeCount} geolocated places · labels show when zoomed in</small>}
          {!placesLayerReady && <small>Loading geolocated places…</small>}
          {!planLayersReady && <small>Loading official plans…</small>}
          {districtPlansVisible && !districtLayerReady && <small>Loading district plans…</small>}
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
