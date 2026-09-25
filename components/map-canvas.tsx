"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Layers3, Navigation } from "lucide-react";
import { BackendRoutingProvider, type Coordinate, type TravelMode } from "@/lib/map-providers";
import { roadLegForJob } from "@/lib/route-leg";
import { positionAtSimTime, roadLineFeatures } from "@/lib/route-playback";
import { engineerSpeedKmh } from "@/lib/transport-speed";
import { minutesLabel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";

export type RoutingState = "idle" | "loading" | "ready" | "fallback";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OSM_RASTER_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

const emptyLines: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features: [] };

export function routeCoordinates(engineer: Engineer, list: Job[], baseline = false, plan?: RoutePlan | null) {
  if (plan?.stops.length) {
    const byId = new Map(list.map(job => [job.id, job]));
    return [engineer.start, ...plan.stops.map(stop => byId.get(stop.jobId)?.coordinates).filter((point): point is Coordinate => Boolean(point))];
  }
  const assigned = list
    .filter(job => (baseline ? job.baselineEngineerId : job.engineerId) === engineer.id)
    .sort((a, b) => a.windowStart - b.windowStart || a.windowEnd - b.windowEnd);
  return [engineer.start, ...assigned.map(job => job.coordinates)];
}

function remainingLabel(mins: number) {
  const value = Math.max(0, Math.ceil(mins));
  if (value >= 60) return `${Math.floor(value / 60)} ч ${value % 60} мин`;
  return `${value} мин`;
}

export type PlaybackPhase = "idle" | "travel" | "wait" | "service" | "done";

export function actionAtSimTime(engineer: Engineer, plan: RoutePlan | null, simTime: number) {
  if (!plan?.stops.length) return { phase: "idle" as PlaybackPhase, jobId: null as string | null, remaining: 0, index: 0, total: 0 };
  const total = plan.stops.length;
  if (simTime < engineer.shiftStart) return { phase: "idle" as PlaybackPhase, jobId: plan.stops[0].jobId, remaining: engineer.shiftStart - simTime, index: 0, total };
  for (let i = 0; i < plan.stops.length; i++) {
    const stop = plan.stops[i];
    if (simTime < stop.arrival) return { phase: "travel" as PlaybackPhase, jobId: stop.jobId, remaining: stop.arrival - simTime, index: i + 1, total };
    if (simTime < stop.start) return { phase: "wait" as PlaybackPhase, jobId: stop.jobId, remaining: stop.start - simTime, index: i + 1, total };
    if (simTime < stop.end) return { phase: "service" as PlaybackPhase, jobId: stop.jobId, remaining: stop.end - simTime, index: i + 1, total };
  }
  const last = plan.stops[plan.stops.length - 1];
  return { phase: "done" as PlaybackPhase, jobId: last.jobId, remaining: 0, index: total, total };
}

export function actionCopy(phase: PlaybackPhase) {
  if (phase === "travel") return "Направляется к";
  if (phase === "wait") return "Ожидает окно";
  if (phase === "service") return "Выполняет задачу";
  if (phase === "done") return "Маршрут завершён";
  return "Выезжает с базы";
}

function lineFeature(engineer: Engineer, coordinates: Coordinate[], selected: boolean, opacity = 1): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: "Feature", properties: { id: engineer.id, color: engineer.color, selected: selected ? 1 : 0, opacity }, geometry: { type: "LineString", coordinates: coordinates.length >= 2 ? coordinates : [engineer.start, engineer.start] } };
}

function setLineSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection<GeoJSON.LineString>) {
  (map.getSource(id) as { setData: (data: GeoJSON.FeatureCollection) => void } | undefined)?.setData(data);
}

function roadMode(transport: string): TravelMode {
  return transport === "Пешком" || transport === "Пешеход" ? "walking" : transport === "Велосипед" ? "cycling" : transport === "Общественный транспорт" ? "transit" : "driving";
}

async function roadLine(waypoints: Coordinate[], provider: BackendRoutingProvider, mode: TravelMode = "driving"): Promise<[Coordinate[], boolean, string]> {
  if (waypoints.length < 2) return [waypoints, false, "none"];
  try {
    const result = await provider.buildRoute({ points: waypoints, mode });
    const coords = result.geometry.coordinates as Coordinate[];
    if (!["osrm", "yandex", "valhalla", "walking-estimate"].includes(result.provider)) return [[], true, "unavailable"];
    if (coords.length < 2 || !Number.isFinite(result.distanceMeters)) return [[], true, "unavailable"];
    return [coords, result.provider === "walking-estimate", result.provider];
  } catch {
    return [[], true, "unavailable"];
  }
}

function positionAtKnownStop(engineer: Engineer, plan: RoutePlan, jobs: Job[], simTime: number) {
  const byId = new Map(jobs.map(job => [job.id, job]));
  let lastKnown = engineer.start;
  if (simTime < engineer.shiftStart) return lastKnown;
  for (const stop of plan.stops) {
    if (simTime < stop.arrival) return lastKnown;
    const destination = byId.get(stop.jobId)?.coordinates;
    if (destination) lastKnown = destination;
    if (simTime <= stop.end) return lastKnown;
  }
  return lastKnown;
}

async function fetchRoadLines(engineers: Engineer[], jobs: Job[], plans: Map<string, RoutePlan>, baseline: boolean, provider: BackendRoutingProvider, cancelled: () => boolean, onBatch?: (batch: Array<readonly [string, Coordinate[], boolean, string]>) => void) {
  const results: Array<readonly [string, Coordinate[], boolean, string]> = [];
  for (let offset = 0; offset < engineers.length; offset += 3) {
    const batch = await Promise.all(engineers.slice(offset, offset + 3).map(async engineer => {
      const waypoints = routeCoordinates(engineer, jobs, baseline, plans.get(engineer.id));
      if (waypoints.length < 2) return [engineer.id, waypoints, false, "none"] as const;
      const [line, failed, source] = await roadLine(waypoints, provider, roadMode(engineer.transport));
      return [engineer.id, line, failed, source] as const;
    }));
    results.push(...batch);
    if (cancelled()) break;
    onBatch?.(batch);
  }
  return results;
}

function useRoadRoutes(
  routingEnabled: boolean,
  compare: boolean,
  visibleEngineers: Engineer[],
  visibleJobs: Job[],
  routes: RoutePlan[],
  baselineEngineers: Engineer[],
  baselineJobs: Job[],
  baselineRoutes: RoutePlan[],
  providerId: "osrm" | "yandex",
  apiKey: string,
  onRoutingState: (state: RoutingState) => void,
) {
  const [roadRoutes, setRoadRoutes] = useState<Record<string, Coordinate[]>>({});
  const [routeSources, setRouteSources] = useState<Record<string, string>>({});
  const [baselineRoads, setBaselineRoads] = useState<Record<string, Coordinate[]>>({});
  const [routeStatus, setRouteStatus] = useState<RoutingState>(routingEnabled ? "loading" : "idle");
  const planByEngineer = useMemo(() => new Map(routes.map(route => [route.engineerId, route])), [routes]);
  const baselineByEngineer = useMemo(() => new Map(baselineRoutes.map(route => [route.engineerId, route])), [baselineRoutes]);
  useEffect(() => {
    if (!routingEnabled) {
      // Reset cached external routing state when road routing is disabled.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoadRoutes({});
      setRouteSources({});
      setRouteStatus("idle");
      onRoutingState("idle");
      return;
    }
    let cancelled = false;
    setRouteStatus("loading");
    setRoadRoutes({});
    setRouteSources({});
    onRoutingState("loading");
    const provider = new BackendRoutingProvider(providerId, "/api/routing", apiKey);
    void (async () => {
      const results = await fetchRoadLines(visibleEngineers, visibleJobs, planByEngineer, false, provider, () => cancelled, batch => {
        setRoadRoutes(current => ({ ...current, ...Object.fromEntries(batch.map(([id, coords]) => [id, coords])) }));
        setRouteSources(current => ({ ...current, ...Object.fromEntries(batch.map(([id, , , source]) => [id, source])) }));
      });
      if (cancelled) return;
      const state: RoutingState = results.some(item => item[2]) ? "fallback" : "ready";
      setRoadRoutes(Object.fromEntries(results.map(([id, coords]) => [id, coords])));
      setRouteSources(Object.fromEntries(results.map(([id, , , source]) => [id, source])));
      setRouteStatus(state);
      onRoutingState(state);
    })();
    return () => { cancelled = true; };
  }, [routingEnabled, visibleEngineers, visibleJobs, planByEngineer, providerId, apiKey, onRoutingState]);
  useEffect(() => {
    if (!routingEnabled || !compare) {
      // The comparison layer must disappear immediately when its toggle closes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBaselineRoads({});
      return;
    }
    let cancelled = false;
    setBaselineRoads({});
    const provider = new BackendRoutingProvider(providerId, "/api/routing", apiKey);
    void (async () => {
      const results = await fetchRoadLines(baselineEngineers, baselineJobs, baselineByEngineer, true, provider, () => cancelled);
      if (cancelled) return;
      setBaselineRoads(Object.fromEntries(results.map(([id, coords]) => [id, coords])));
    })();
    return () => { cancelled = true; };
  }, [routingEnabled, compare, baselineEngineers, baselineJobs, baselineByEngineer, providerId, apiKey]);
  return { roadRoutes, routeSources, baselineRoads, routeStatus };
}

function captionText(status: RoutingState) {
  if (status === "idle") return "OpenStreetMap · точки по адресам зданий";
  if (status === "loading") return "OpenStreetMap · загружаем линии по дорогам";
  if (status === "ready") return "OpenStreetMap · маршруты по дорожному графу";
  return "Часть линий оценочная или недоступна · прямые скрыты";
}

function MapChrome({ caption, status, clockRef, onFit, onZoomIn, onZoomOut }: { caption: string; status: RoutingState; clockRef?: Ref<HTMLSpanElement>; onFit: () => void; onZoomIn: () => void; onZoomOut: () => void }) {
  return <>
    <div className="map-tools">
      <button aria-label="Показать все маршруты" onClick={onFit}><Layers3 size={17} /></button>
      <span />
      <button aria-label="Увеличить карту" onClick={onZoomIn}>+</button>
      <button aria-label="Уменьшить карту" onClick={onZoomOut}>−</button>
    </div>
    <div className={`map-caption ${status}`}><Navigation size={14} />{caption}<span ref={clockRef} className="playback-clock" /></div>
  </>;
}

type CanvasProps = {
  visibleJobs: Job[];
  baselineJobs: Job[];
  engineers: Engineer[];
  selectedEngineerId: string | null;
  selectedJobId: string | null;
  simTime: number | null;
  simPlaying: boolean;
  simSpeed: number;
  carSpeedKmh: number;
  simEnd: number;
  onSimTime: (time: number) => void;
  onSimPlaying: (playing: boolean) => void;
  compare: boolean;
  routingEnabled: boolean;
  routes: RoutePlan[];
  baselineRoutes: RoutePlan[];
  onSelectEngineer: (id: string) => void;
  onSelectJob: (id: string) => void;
  onInspectJob: (id: string) => void;
  onRoutingState: (state: RoutingState) => void;
};

function useVisibleMarkers(visibleJobs: Job[], engineers: Engineer[], routingEnabled: boolean, selectedEngineerId: string | null, selectedJobId: string | null) {
  const markerJobs = useMemo(() => (selectedJobId ? visibleJobs.filter(job => job.id === selectedJobId) : selectedEngineerId ? visibleJobs.filter(job => job.engineerId === selectedEngineerId) : visibleJobs).slice(0, 220), [visibleJobs, selectedEngineerId, selectedJobId]);
  const visibleEngineerIds = useMemo(() => new Set(visibleJobs.map(job => job.engineerId).filter(Boolean)), [visibleJobs]);
  const visibleRegions = useMemo(() => new Set(visibleJobs.map(job => job.region)), [visibleJobs]);
  const visibleEngineers = useMemo(() => engineers.filter(engineer => visibleEngineerIds.has(engineer.id)), [engineers, visibleEngineerIds]);
  const markerEngineers = useMemo(() => (routingEnabled ? visibleEngineers : engineers.filter(engineer => visibleRegions.has(engineer.region))).filter(engineer => !selectedEngineerId || engineer.id === selectedEngineerId).slice(0, 80), [routingEnabled, visibleEngineers, engineers, visibleRegions, selectedEngineerId]);
  return { markerJobs, visibleEngineers, markerEngineers };
}

function markerButton(className: string, text: string, color: string, title: string, onClick: () => void) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = className;
  el.textContent = text;
  el.style.setProperty("--marker", color);
  el.title = title;
  el.onclick = onClick;
  return el;
}

export function engineerMarkerLabel(engineer: Pick<Engineer, "name" | "initials">) {
  const words = engineer.name.trim().split(/\s+/).filter(Boolean);
  const label = words.slice(0, 2).map(word => word[0]?.toLocaleUpperCase("ru-RU") ?? "").join("");
  return label || engineer.initials || "И";
}

export function MapCanvas(props: CanvasProps) {
  const { visibleJobs, baselineJobs, engineers, selectedEngineerId, selectedJobId, simTime, simPlaying, simSpeed, carSpeedKmh, simEnd, onSimTime, onSimPlaying, compare, routingEnabled, routes, baselineRoutes, onSelectEngineer, onSelectJob, onInspectJob, onRoutingState } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const vehiclesRef = useRef<Map<string, Marker>>(new Map());
  const clockRef = useRef<HTMLSpanElement>(null);
  const actionBoxRef = useRef<HTMLDivElement>(null);
  const actionTextRef = useRef<HTMLSpanElement>(null);
  const actionJobRef = useRef<HTMLButtonElement>(null);
  const actionMetaRef = useRef<HTMLElement>(null);
  const loadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const simulating = simTime != null;
  const { markerJobs, visibleEngineers, markerEngineers } = useVisibleMarkers(visibleJobs, engineers, routingEnabled, selectedEngineerId, selectedJobId);
  const baselineEngineers = useMemo(() => {
    const ids = new Set((baselineRoutes.length ? baselineRoutes.map(route => route.engineerId) : baselineJobs.map(job => job.baselineEngineerId)).filter((id): id is string => Boolean(id)));
    return engineers.filter(engineer => ids.has(engineer.id));
  }, [engineers, baselineRoutes, baselineJobs]);
  const { roadRoutes, routeSources, baselineRoads, routeStatus } = useRoadRoutes(routingEnabled, compare, visibleEngineers, visibleJobs, routes, baselineEngineers, baselineJobs, baselineRoutes, "osrm", "", onRoutingState);
  const latestRef = useRef({ visibleJobs, visibleEngineers, compare, routingEnabled });
  useEffect(() => { latestRef.current = { visibleJobs, visibleEngineers, compare, routingEnabled }; }, [visibleJobs, visibleEngineers, compare, routingEnabled]);
  const planByEngineer = useMemo(() => new Map(routes.map(route => [route.engineerId, route])), [routes]);
  const selectedRouteEngineer = engineers.find(engineer => engineer.id === selectedEngineerId);
  const selectedRoutePlan = selectedEngineerId ? planByEngineer.get(selectedEngineerId) : undefined;
  const [focusedRoad, setFocusedRoad] = useState<{ key: string; coordinates: Coordinate[]; source: string } | null>(null);
  const rawSelectedLeg = useMemo(() => selectedJobId && selectedRouteEngineer && selectedRoutePlan
    ? roadLegForJob(selectedRouteEngineer, selectedRoutePlan, visibleJobs, roadRoutes[selectedRouteEngineer.id] ?? [], selectedJobId)
    : null, [selectedJobId, selectedRouteEngineer, selectedRoutePlan, visibleJobs, roadRoutes]);
  const legKey = rawSelectedLeg && selectedJobId ? `${selectedJobId}:${rawSelectedLeg.origin.join(",")}:${rawSelectedLeg.destination.join(",")}` : "";
  useEffect(() => {
    if (!rawSelectedLeg || !selectedJobId) return;
    let cancelled = false;
    const provider = new BackendRoutingProvider("osrm", "/api/routing");
    void roadLine([rawSelectedLeg.origin, rawSelectedLeg.destination], provider, roadMode(selectedRouteEngineer?.transport ?? "Автомобиль")).then(([coordinates, , source]) => {
      if (!cancelled) setFocusedRoad({ key: legKey, coordinates, source });
    });
    return () => { cancelled = true; };
    // The route request depends on the selected stop and endpoints, not on the
    // background whole-route geometry used as a fallback while it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legKey]);
  const selectedLeg = useMemo(() => rawSelectedLeg && selectedJobId
    ? { ...rawSelectedLeg, coordinates: focusedRoad?.key === legKey && focusedRoad.coordinates.length >= 2 ? focusedRoad.coordinates : rawSelectedLeg.coordinates }
    : null, [rawSelectedLeg, selectedJobId, focusedRoad, legKey]);
  const routeFor = useCallback((engineer: Engineer) => roadRoutes[engineer.id] ?? [], [roadRoutes]);
  const selectedRoadSource = selectedLeg && focusedRoad?.key === legKey && focusedRoad.coordinates.length >= 2 ? focusedRoad.source : selectedRouteEngineer ? routeSources[selectedRouteEngineer.id] : undefined;
  const baselineFor = useCallback((engineer: Engineer) => {
    return baselineRoads[engineer.id] ?? [];
  }, [baselineRoads]);
  const routeData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (!routingEnabled) return emptyLines;
    if (selectedJobId) {
      return selectedLeg?.coordinates.length && selectedRouteEngineer
        ? { type: "FeatureCollection", features: [lineFeature({ ...selectedRouteEngineer, color: "#f43f5e" }, selectedLeg.coordinates, true)] }
        : emptyLines;
    }
    return roadLineFeatures(visibleEngineers, roadRoutes, selectedEngineerId);
  }, [routingEnabled, visibleEngineers, selectedEngineerId, selectedJobId, selectedLeg, selectedRouteEngineer, roadRoutes]);
  const baselineData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (!routingEnabled || !compare || selectedEngineerId || selectedJobId) return emptyLines;
    return {
      type: "FeatureCollection",
      features: baselineEngineers.filter(engineer => !selectedEngineerId || engineer.id === selectedEngineerId)
        .map(engineer => {
          const coords = baselineFor(engineer);
          return coords.length >= 2 ? lineFeature(engineer, coords, false, 1) : null;
        })
        .filter((feature): feature is GeoJSON.Feature<GeoJSON.LineString> => Boolean(feature)),
    };
  }, [routingEnabled, compare, baselineEngineers, baselineFor, selectedEngineerId, selectedJobId]);
  const fitCoords = useCallback(async (points: Coordinate[], maxZoom = 13.2, selected = false) => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !points.length) return;
    const { LngLatBounds } = await import("maplibre-gl");
    const bounds = new LngLatBounds(points[0], points[0]);
    points.slice(1).forEach(point => bounds.extend(point));
    const padding = selected
      ? { top: 56, right: 56, bottom: 56, left: Math.max(56, Math.min(265, map.getContainer().clientWidth - 320)) }
      : 56;
    map.fitBounds(bounds, { padding, maxZoom, duration: 550 });
  }, []);
  const fitVisible = useCallback(async () => {
    const all = [...markerJobs.map(job => job.coordinates), ...markerEngineers.map(engineer => engineer.start)];
    await fitCoords(all, 12.5);
  }, [markerJobs, markerEngineers, fitCoords]);
  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const vehicles = vehiclesRef.current;
    const markers = markersRef.current;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current || mapRef.current) return;
      setMapReady(false);
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new maplibre.Map({
        container: containerRef.current,
        center: [37.67, 55.67],
        zoom: 9.6,
        attributionControl: false,
        style: OPENFREEMAP_STYLE,
      });
      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      let usedRasterFallback = false;
      map.on("error", event => {
        const url = (event.error as Error & { url?: string })?.url ?? "";
        if (usedRasterFallback || !url.includes("openfreemap.org")) return;
        usedRasterFallback = true;
        setMapReady(false);
        map.setStyle(OSM_RASTER_STYLE);
      });
      map.on("styleimagemissing", event => {
        if (!map.hasImage(event.id)) {
          map.addImage(event.id, { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 0]) });
        }
      });
      map.on("style.load", () => {
        loadedRef.current = true;
        (map.getContainer() as HTMLElement & { __ffMap?: MapLibreMap }).__ffMap = map;
        const current = latestRef.current;
        const initial = emptyLines;
        if (!map.getSource("baseline-routes")) {
          map.addSource("baseline-routes", { type: "geojson", data: emptyLines });
          map.addLayer({ id: "baseline-routes", type: "line", source: "baseline-routes", layout: { visibility: current.compare ? "visible" : "none" }, paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": .38 } });
        }
        if (!map.getSource("routes")) {
          map.addSource("routes", { type: "geojson", data: initial });
          map.addLayer({ id: "route-shadow", type: "line", source: "routes", paint: { "line-color": "#fff", "line-width": ["case", ["==", ["get", "selected"], 1], 10, 7], "line-opacity": ["*", 0.8, ["coalesce", ["get", "opacity"], 1]] } });
          map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 6, 3.5], "line-opacity": ["*", ["case", ["==", ["get", "selected"], 1], 1, .72], ["coalesce", ["get", "opacity"], 1]] } });
        }
        setMapReady(true);
        requestAnimationFrame(() => map.resize());
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      vehicles.forEach(marker => marker.remove());
      vehicles.clear();
      markers.forEach(marker => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setLineSource(map, "baseline-routes", baselineData);
    setLineSource(map, "routes", routeData);
    if (map.getLayer("baseline-routes")) map.setLayoutProperty("baseline-routes", "visibility", compare && routingEnabled && !simPlaying ? "visible" : "none");
  }, [routeData, baselineData, compare, routingEnabled, simulating, simPlaying, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.length = 0;
    void import("maplibre-gl").then(({ Marker }) => {
      if (!mapRef.current) return;
      if (!simulating) {
        markerEngineers.forEach(engineer => {
          const el = markerButton(`engineer-map-marker${selectedEngineerId === engineer.id ? " selected" : ""}`, engineerMarkerLabel(engineer), engineer.color, engineer.name, () => onSelectEngineer(engineer.id));
          markersRef.current.push(new Marker({ element: el }).setLngLat(engineer.start).addTo(mapRef.current!));
        });
      }
      markerJobs.forEach((job, index) => {
        if (!job.engineerId && routingEnabled && selectedJobId !== job.id) return;
        const engineer = engineers.find(item => item.id === job.engineerId);
        const color = engineer?.color ?? "#6b7280";
        const el = markerButton(`job-map-marker${selectedJobId === job.id ? " selected" : ""}`, String(index + 1), color, `№ ${job.id} · ${job.address}`, () => onSelectJob(job.id));
        markersRef.current.push(new Marker({ element: el }).setLngLat(job.coordinates).addTo(mapRef.current!));
      });
      if (selectedLeg) {
        const origin = markerButton("leg-origin-marker", "ОТ", "#18213a", selectedLeg.originLabel, () => {});
        markersRef.current.push(new Marker({ element: origin }).setLngLat(selectedLeg.origin).addTo(mapRef.current!));
      }
    });
  }, [compare, routingEnabled, simulating, selectedEngineerId, selectedJobId, selectedLeg, markerEngineers, markerJobs, engineers, onSelectEngineer, onSelectJob, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const job = visibleJobs.find(item => item.id === selectedJobId);
    if (job && selectedLeg) {
      void fitCoords(selectedLeg.coordinates.length >= 2 ? selectedLeg.coordinates : [selectedLeg.origin, selectedLeg.destination], 15.5, true);
      return;
    }
    if (job) {
      map.flyTo({ center: job.coordinates, zoom: 16, duration: 500 });
      return;
    }
    const engineer = engineers.find(item => item.id === selectedEngineerId);
    if (engineer) {
      const road = routeFor(engineer);
      void fitCoords(road.length >= 2 ? road : [engineer.start, ...visibleJobs.filter(job => job.engineerId === engineer.id).map(job => job.coordinates)], 13.2, true);
      return;
    }
    void fitVisible();
  }, [selectedJobId, selectedEngineerId, selectedLeg, visibleJobs, engineers, routeFor, fitCoords, fitVisible, mapReady]);
  const simPlayingRef = useRef(simPlaying);
  const simSpeedRef = useRef(simSpeed);
  const simTimeRef = useRef(simTime);
  const simEndRef = useRef(simEnd);
  const fleetRef = useRef({ visibleEngineers, visibleJobs, engineers, selectedEngineerId, planByEngineer, routeFor, routeSources, onSelectEngineer, onSimTime, onSimPlaying, compare, routeData, baselineData });
  useEffect(() => {
    simPlayingRef.current = simPlaying;
    simSpeedRef.current = simSpeed;
    simTimeRef.current = simTime;
    simEndRef.current = simEnd;
    fleetRef.current = { visibleEngineers, visibleJobs, engineers, selectedEngineerId, planByEngineer, routeFor, routeSources, onSelectEngineer, onSimTime, onSimPlaying, compare, routeData, baselineData };
  }, [simPlaying, simSpeed, simTime, simEnd, visibleEngineers, visibleJobs, engineers, selectedEngineerId, planByEngineer, routeFor, routeSources, onSelectEngineer, onSimTime, onSimPlaying, compare, routeData, baselineData]);
  useEffect(() => {
    const map = mapRef.current;
    const clearVehicles = () => {
      vehiclesRef.current.forEach(marker => marker.remove());
      vehiclesRef.current.clear();
    };
    if (!map || !loadedRef.current || simTimeRef.current == null) {
      clearVehicles();
      if (clockRef.current) clockRef.current.textContent = "";
      if (actionBoxRef.current) actionBoxRef.current.hidden = true;
      return;
    }
    let cancelled = false;
    let frame = 0;
    let last = performance.now();
    let emit = 0;
    let clock = simTimeRef.current;
    let wasPlaying = simPlayingRef.current;
    const writeHud = (time: number, movers: Engineer[]) => {
      const focus = fleetRef.current.engineers.find(item => item.id === fleetRef.current.selectedEngineerId) ?? movers[0];
      if (clockRef.current) clockRef.current.textContent = ` · ${minutesLabel(time)} · смена`;
      if (!focus || !actionBoxRef.current || !actionTextRef.current || !actionJobRef.current || !actionMetaRef.current) return;
      const plan = fleetRef.current.planByEngineer.get(focus.id) ?? null;
      const action = actionAtSimTime(focus, plan, time);
      actionBoxRef.current.hidden = false;
      actionTextRef.current.textContent = `${focus.name}: ${actionCopy(action.phase)}`;
      if (action.jobId && action.phase !== "idle") {
        actionJobRef.current.hidden = false;
        actionJobRef.current.dataset.job = action.jobId;
        actionJobRef.current.textContent = `№ ${action.jobId}`;
      } else {
        actionJobRef.current.hidden = true;
        actionJobRef.current.dataset.job = "";
        actionJobRef.current.textContent = "";
      }
      if (action.phase === "travel") actionMetaRef.current.textContent = `До прибытия ${remainingLabel(action.remaining)} · заявка ${action.index} из ${action.total}${fleetRef.current.routeFor(focus).length < 2 ? " · дорога недоступна, показана последняя известная точка" : ""}`;
      else if (action.phase === "wait") actionMetaRef.current.textContent = `До начала окна ${remainingLabel(action.remaining)}`;
      else if (action.phase === "service") actionMetaRef.current.textContent = `Осталось ${remainingLabel(action.remaining)}`;
      else if (action.phase === "done") actionMetaRef.current.textContent = "Маршрут инженера закрыт";
      else actionMetaRef.current.textContent = movers.length > 1 ? `${movers.length} инженеров на карте` : "Старт с базы";
    };
    const paint = (Marker: typeof import("maplibre-gl").Marker, time: number) => {
      const host = mapRef.current;
      if (!host) return;
      const { visibleEngineers: moversSource, visibleJobs: jobs, selectedEngineerId: selected, planByEngineer: plans, routeFor: coordsOf, onSelectEngineer: select } = fleetRef.current;
      const movers = moversSource.filter(engineer => (!selected || engineer.id === selected) && Boolean(plans.get(engineer.id)?.stops.length)).slice(0, 24);
      const keep = new Set(movers.map(engineer => engineer.id));
      for (const [id, marker] of vehiclesRef.current) {
        if (!keep.has(id)) {
          marker.remove();
          vehiclesRef.current.delete(id);
        }
      }
      for (const engineer of movers) {
        const coords = coordsOf(engineer);
        const plan = plans.get(engineer.id) ?? null;
        const hasRoad = coords.length >= 2;
        const estimated = fleetRef.current.routeSources[engineer.id] === "walking-estimate";
        const action = actionAtSimTime(engineer, plan, time);
        const pose = plan && hasRoad ? positionAtSimTime(engineer, plan, jobs, coords, time) : null;
        // With no road graph, do not fake a straight trip or visibly teleport:
        // hide the position during travel and show only verified stop locations.
        if (!pose && action.phase === "travel") {
          vehiclesRef.current.get(engineer.id)?.remove();
          vehiclesRef.current.delete(engineer.id);
          continue;
        }
        const point = pose?.point ?? positionAtKnownStop(engineer, plan!, jobs, time);
        const label = engineerMarkerLabel(engineer);
        let marker = vehiclesRef.current.get(engineer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = `route-vehicle-marker${hasRoad && !estimated ? "" : " estimated"}`;
          el.style.setProperty("--marker", engineer.color);
          el.textContent = label;
          el.title = `${engineer.name} · ${estimated ? "оценочное положение по пешеходному графу; не маршрут ОТ" : hasRoad ? "положение на дорожном маршруте" : "последняя известная точка; дорога недоступна"}`;
          el.setAttribute("aria-label", el.title);
          el.dataset.engineerId = engineer.id;
          el.onclick = () => select(engineer.id);
          marker = new Marker({ element: el, anchor: "center" }).setLngLat(point).addTo(host);
          vehiclesRef.current.set(engineer.id, marker);
        } else {
          marker.setLngLat(point);
          marker.getElement().classList.toggle("estimated", !hasRoad || estimated);
          marker.getElement().textContent = label;
          marker.getElement().title = `${engineer.name} · ${estimated ? "оценочное положение по пешеходному графу; не маршрут ОТ" : hasRoad ? "положение на дорожном маршруте" : "последняя известная точка; дорога недоступна"}`;
          marker.getElement().setAttribute("aria-label", marker.getElement().title);
        }
        marker.getElement().dataset.position = point.join(",");
      }
      writeHud(time, movers);
    };
    void import("maplibre-gl").then(({ Marker }) => {
      if (cancelled || !mapRef.current) return;
      paint(Marker, clock);
      const tick = (now: number) => {
        if (cancelled || !mapRef.current) return;
        const dt = Math.max(0, (now - last) / 1000);
        last = now;
        if (simPlayingRef.current) {
          if (!wasPlaying) clock = simTimeRef.current ?? clock;
          wasPlaying = true;
          clock = Math.min(simEndRef.current, clock + dt * Math.max(0.1, simSpeedRef.current));
          emit += dt;
          if (clock >= simEndRef.current) {
            wasPlaying = false;
            fleetRef.current.onSimTime(simEndRef.current);
            fleetRef.current.onSimPlaying(false);
          } else if (emit > 0.12) {
            emit = 0;
            fleetRef.current.onSimTime(clock);
          }
        } else {
          wasPlaying = false;
          clock = simTimeRef.current ?? clock;
        }
        paint(Marker, clock);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [simulating, mapReady]);
  return <div className="map-canvas real-map" aria-label="Интерактивная карта маршрутов инженеров">
    <div ref={containerRef} className="maplibre-host" data-route-features={routeData.features.length} data-route-points={routeData.features.reduce((sum, feature) => sum + feature.geometry.coordinates.length, 0)} data-road-status={routeStatus} />
    {selectedRouteEngineer && <div className="selected-route-summary" style={{ ["--route-color" as string]: selectedLeg ? "#f43f5e" : selectedRouteEngineer.color }}><span>{selectedLeg ? "Участок к выбранной заявке" : "Маршрут инженера"}</span><strong>{selectedRouteEngineer.name}</strong>{selectedLeg ? <><small>{selectedLeg.originLabel} → {selectedLeg.destinationLabel}</small><small>Прибытие {minutesLabel(selectedLeg.stop.arrival)} · участок {selectedLeg.stop.distanceKm.toFixed(1).replace(".", ",")} км</small></> : <small>{selectedRoutePlan?.stops.length ?? 0} заявок · {selectedRoutePlan ? `${selectedRoutePlan.distanceKm.toFixed(1).replace(".", ",")} км` : "маршрут не построен"}</small>}<small>{selectedRouteEngineer.transport} · скорость {engineerSpeedKmh(selectedRouteEngineer.transport, selectedRouteEngineer.speedKmh, carSpeedKmh)} км/ч</small>{selectedRoadSource === "walking-estimate" ? <small>Для ОТ показан пешеходный путь как оценка; движение и линия не являются фактическим маршрутом транспорта</small> : selectedRoadSource === "unavailable" ? <small>Дорожная линия недоступна · движение между точками скрыто</small> : selectedRoadSource && selectedRoadSource !== "none" ? <small>Геометрия по сети дорог · {selectedRoadSource}</small> : <small>Загружаем дорожную геометрию…</small>}<button type="button" onClick={() => onSelectEngineer(selectedRouteEngineer.id)}>Показать все маршруты</button></div>}
    <MapChrome caption={captionText(routeStatus)} status={routeStatus} clockRef={clockRef} onFit={() => { if (selectedEngineerId) onSelectEngineer(selectedEngineerId); else void fitVisible(); }} onZoomIn={() => mapRef.current?.zoomIn()} onZoomOut={() => mapRef.current?.zoomOut()} />
    <div ref={actionBoxRef} className="playback-action" hidden>
      <strong>Сейчас</strong>
      <p><span ref={actionTextRef} /><button type="button" className="playback-job-id" ref={actionJobRef} onClick={() => { const id = actionJobRef.current?.dataset.job; if (id) onInspectJob(id); }} /></p>
      <small ref={actionMetaRef} />
    </div>
  </div>;
}
