"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { Layers3, Navigation } from "lucide-react";
import { BackendRoutingProvider, type Coordinate } from "@/lib/map-providers";
import { distanceKm, minutesLabel, type Engineer, type Job, type RoutePlan } from "@/lib/vrptw";

export type RoutingState = "idle" | "loading" | "ready" | "fallback";

const OPENFREEMAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OSM_RASTER_STYLE = {
  version: 8 as const,
  sources: { osm: { type: "raster" as const, tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

const emptyLines: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features: [] };

export function routeCoordinates(engineer: Engineer, list: Job[], baseline = false, plan?: RoutePlan | null) {
  if (!baseline && plan?.stops.length) {
    const byId = new Map(list.map(job => [job.id, job]));
    return [engineer.start, ...plan.stops.map(stop => byId.get(stop.jobId)?.coordinates).filter((point): point is Coordinate => Boolean(point))];
  }
  return [engineer.start, ...list.filter(job => (baseline ? job.baselineEngineerId : job.engineerId) === engineer.id).sort((a, b) => a.windowStart - b.windowStart).map(job => job.coordinates)];
}

function lineLengthKm(coords: Coordinate[]) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += distanceKm(coords[i - 1], coords[i]);
  return sum;
}

function interpolatePoint(a: Coordinate, b: Coordinate, t: number): Coordinate {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sliceByFraction(coords: Coordinate[], fraction: number) {
  if (coords.length < 2) return { line: coords, point: coords[0] ?? [37.67, 55.67] as Coordinate };
  if (fraction >= 1) return { line: coords, point: coords[coords.length - 1] };
  const target = lineLengthKm(coords) * Math.max(0, fraction);
  const line: Coordinate[] = [coords[0]];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const segment = distanceKm(coords[i - 1], coords[i]);
    if (acc + segment >= target) {
      const t = segment === 0 ? 1 : (target - acc) / segment;
      const point = interpolatePoint(coords[i - 1], coords[i], t);
      line.push(point);
      return { line, point };
    }
    acc += segment;
    line.push(coords[i]);
  }
  return { line: coords, point: coords[coords.length - 1] };
}

function waypointIndices(coords: Coordinate[], waypoints: Coordinate[]) {
  const indices = [0];
  let from = 0;
  for (let i = 1; i < waypoints.length; i++) {
    let best = from;
    let bestD = Infinity;
    for (let j = from; j < coords.length; j++) {
      const d = distanceKm(coords[j], waypoints[i]);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    indices.push(Math.max(best, from));
    from = indices[i];
  }
  return indices;
}

function positionAtSimTime(engineer: Engineer, plan: RoutePlan, jobs: Job[], coords: Coordinate[], simTime: number) {
  const byId = new Map(jobs.map(job => [job.id, job]));
  const waypoints: Coordinate[] = [engineer.start];
  for (const stop of plan.stops) {
    const job = byId.get(stop.jobId);
    if (job) waypoints.push(job.coordinates);
  }
  const indices = waypointIndices(coords, waypoints);
  const startPoint = coords[0] ?? engineer.start;
  if (simTime <= engineer.shiftStart || coords.length < 2) return { line: [startPoint], point: startPoint, done: false };
  let prevTime = engineer.shiftStart;
  let prevIndex = indices[0] ?? 0;
  for (let i = 0; i < plan.stops.length; i++) {
    const stop = plan.stops[i];
    const destIndex = indices[i + 1] ?? coords.length - 1;
    if (simTime <= stop.arrival) {
      const leg = coords.slice(prevIndex, destIndex + 1);
      const path = leg.length >= 2 ? leg : [coords[prevIndex], coords[destIndex]];
      const sliced = sliceByFraction(path, (simTime - prevTime) / Math.max(1e-6, stop.arrival - prevTime));
      return { line: prevIndex > 0 ? [...coords.slice(0, prevIndex + 1), ...sliced.line.slice(1)] : sliced.line, point: sliced.point, done: false };
    }
    if (simTime <= stop.end) return { line: coords.slice(0, destIndex + 1), point: coords[destIndex], done: false };
    prevTime = stop.end;
    prevIndex = destIndex;
  }
  return { line: coords, point: coords[coords.length - 1], done: true };
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

function useRoadRoutes(routingEnabled: boolean, visibleEngineers: Engineer[], visibleJobs: Job[], routes: RoutePlan[], providerId: "osrm" | "yandex", apiKey: string, onRoutingState: (state: RoutingState) => void) {
  const [roadRoutes, setRoadRoutes] = useState<Record<string, Coordinate[]>>({});
  const [routeStatus, setRouteStatus] = useState<RoutingState>(routingEnabled ? "loading" : "idle");
  const planByEngineer = useMemo(() => new Map(routes.map(route => [route.engineerId, route])), [routes]);
  useEffect(() => {
    if (!routingEnabled) {
      setRoadRoutes({});
      setRouteStatus("idle");
      onRoutingState("idle");
      return;
    }
    let cancelled = false;
    setRouteStatus("loading");
    onRoutingState("loading");
    const provider = new BackendRoutingProvider(providerId, "/api/routing", apiKey);
    void (async () => {
      const results: Array<readonly [string, Coordinate[], boolean]> = [];
      for (let offset = 0; offset < visibleEngineers.length; offset += 3) {
        const batch = await Promise.all(visibleEngineers.slice(offset, offset + 3).map(async engineer => {
          const waypoints = routeCoordinates(engineer, visibleJobs, false, planByEngineer.get(engineer.id));
          if (waypoints.length < 2) return [engineer.id, waypoints, false] as const;
          const line: Coordinate[] = [];
          let failed = false;
          for (let i = 0; i < waypoints.length - 1; i++) {
            try {
              const result = await provider.buildRoute({ points: [waypoints[i], waypoints[i + 1]], mode: "driving" });
              const coords = result.geometry.coordinates as Coordinate[];
              if (result.provider === "fallback" || coords.length < 2) {
                failed = true;
                continue;
              }
              if (line.length) line.push(...coords.slice(1));
              else line.push(...coords);
            } catch {
              failed = true;
            }
          }
          return [engineer.id, line.length >= 2 ? line : waypoints, failed || line.length < 2] as const;
        }));
        results.push(...batch);
        if (cancelled) return;
      }
      if (cancelled) return;
      const state: RoutingState = results.some(item => item[2]) ? "fallback" : "ready";
      setRoadRoutes(Object.fromEntries(results.map(([id, coords]) => [id, coords])));
      setRouteStatus(state);
      onRoutingState(state);
    })();
    return () => { cancelled = true; };
  }, [routingEnabled, visibleEngineers, visibleJobs, planByEngineer, providerId, apiKey, onRoutingState]);
  return { roadRoutes, routeStatus };
}

function captionText(status: RoutingState) {
  if (status === "idle") return "OpenStreetMap · точки по адресам зданий";
  if (status === "loading") return "OpenStreetMap · строим маршруты OSRM";
  if (status === "ready") return "OpenStreetMap · маршруты OSRM по дорогам";
  return "OpenStreetMap · резервная геометрия маршрутов";
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
  simEnd: number;
  onSimTime: (time: number) => void;
  onSimPlaying: (playing: boolean) => void;
  compare: boolean;
  routingEnabled: boolean;
  routes: RoutePlan[];
  onSelectEngineer: (id: string) => void;
  onSelectJob: (id: string) => void;
  onInspectJob: (id: string) => void;
  onRoutingState: (state: RoutingState) => void;
};

function useVisibleMarkers(visibleJobs: Job[], engineers: Engineer[], routingEnabled: boolean) {
  const markerJobs = useMemo(() => visibleJobs.slice(0, 220), [visibleJobs]);
  const visibleEngineerIds = useMemo(() => new Set(visibleJobs.map(job => job.engineerId).filter(Boolean)), [visibleJobs]);
  const visibleRegions = useMemo(() => new Set(visibleJobs.map(job => job.region)), [visibleJobs]);
  const visibleEngineers = useMemo(() => engineers.filter(engineer => visibleEngineerIds.has(engineer.id)), [engineers, visibleEngineerIds]);
  const markerEngineers = useMemo(() => (routingEnabled ? visibleEngineers : engineers.filter(engineer => visibleRegions.has(engineer.region))).slice(0, 80), [routingEnabled, visibleEngineers, engineers, visibleRegions]);
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

export function MapCanvas(props: CanvasProps) {
  const { visibleJobs, baselineJobs, engineers, selectedEngineerId, selectedJobId, simTime, simPlaying, simSpeed, simEnd, onSimTime, onSimPlaying, compare, routingEnabled, routes, onSelectEngineer, onSelectJob, onInspectJob, onRoutingState } = props;
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
  const { markerJobs, visibleEngineers, markerEngineers } = useVisibleMarkers(visibleJobs, engineers, routingEnabled);
  const { roadRoutes, routeStatus } = useRoadRoutes(routingEnabled, visibleEngineers, visibleJobs, routes, "osrm", "", onRoutingState);
  const latestRef = useRef({ visibleJobs, visibleEngineers, compare, routingEnabled });
  useEffect(() => { latestRef.current = { visibleJobs, visibleEngineers, compare, routingEnabled }; }, [visibleJobs, visibleEngineers, compare, routingEnabled]);
  const planByEngineer = useMemo(() => new Map(routes.map(route => [route.engineerId, route])), [routes]);
  const routeFor = useCallback((engineer: Engineer) => roadRoutes[engineer.id] ?? routeCoordinates(engineer, visibleJobs, false, planByEngineer.get(engineer.id)), [roadRoutes, visibleJobs, planByEngineer]);
  const routeData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => {
    if (!routingEnabled) return emptyLines;
    return {
      type: "FeatureCollection",
      features: visibleEngineers.map(engineer => {
        const selected = selectedEngineerId === engineer.id;
        return lineFeature(engineer, routeFor(engineer), selected, selectedEngineerId && !selected ? 0.28 : 1);
      }),
    };
  }, [routingEnabled, visibleEngineers, selectedEngineerId, routeFor]);
  const baselineData = useMemo<GeoJSON.FeatureCollection<GeoJSON.LineString>>(() => routingEnabled && compare && !simulating ? ({ type: "FeatureCollection", features: visibleEngineers.map(engineer => lineFeature(engineer, routeCoordinates(engineer, baselineJobs, true), false, 1)) }) : emptyLines, [routingEnabled, compare, simulating, visibleEngineers, baselineJobs]);
  const fitCoords = useCallback(async (points: Coordinate[], maxZoom = 13.2) => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !points.length) return;
    const { LngLatBounds } = await import("maplibre-gl");
    const bounds = new LngLatBounds(points[0], points[0]);
    points.slice(1).forEach(point => bounds.extend(point));
    map.fitBounds(bounds, { padding: 56, maxZoom, duration: 550 });
  }, []);
  const fitVisible = useCallback(async () => {
    const all = [...markerJobs.map(job => job.coordinates), ...markerEngineers.map(engineer => engineer.start)];
    await fitCoords(all, 12.5);
  }, [markerJobs, markerEngineers, fitCoords]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !containerRef.current || mapRef.current) return;
      maplibre.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new maplibre.Map({
        container: containerRef.current,
        center: [37.67, 55.67],
        zoom: 9.6,
        attributionControl: false,
        style: OPENFREEMAP_STYLE,
      });
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-right");
      let usedRasterFallback = false;
      map.on("error", (event: { error?: { url?: string } }) => {
        const url = event.error?.url ?? "";
        if (usedRasterFallback || !url.includes("openfreemap.org")) return;
        usedRasterFallback = true;
        map.setStyle(OSM_RASTER_STYLE);
      });
      map.on("style.load", () => {
        loadedRef.current = true;
        const current = latestRef.current;
        const initial: GeoJSON.FeatureCollection<GeoJSON.LineString> = current.routingEnabled ? { type: "FeatureCollection", features: current.visibleEngineers.map(engineer => ({ type: "Feature", properties: { id: engineer.id, color: engineer.color, selected: 0 }, geometry: { type: "LineString", coordinates: routeCoordinates(engineer, current.visibleJobs) } })) } : emptyLines;
        if (!map.getSource("baseline-routes")) {
          map.addSource("baseline-routes", { type: "geojson", data: initial });
          map.addLayer({ id: "baseline-routes", type: "line", source: "baseline-routes", layout: { visibility: current.compare ? "visible" : "none" }, paint: { "line-color": ["get", "color"], "line-width": 4, "line-opacity": .38, "line-dasharray": [1, 1.5] } });
        }
        if (!map.getSource("route-ghost")) {
          map.addSource("route-ghost", { type: "geojson", data: emptyLines });
          map.addLayer({ id: "route-ghost", type: "line", source: "route-ghost", paint: { "line-color": ["get", "color"], "line-width": 5, "line-opacity": .22, "line-dasharray": [1.2, 1.6] } });
        }
        if (!map.getSource("routes")) {
          map.addSource("routes", { type: "geojson", data: initial });
          map.addLayer({ id: "route-shadow", type: "line", source: "routes", paint: { "line-color": "#fff", "line-width": ["case", ["==", ["get", "selected"], 1], 10, 7], "line-opacity": ["*", 0.8, ["coalesce", ["get", "opacity"], 1]] } });
          map.addLayer({ id: "routes", type: "line", source: "routes", paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "selected"], 1], 6, 3.5], "line-opacity": ["*", ["case", ["==", ["get", "selected"], 1], 1, .72], ["coalesce", ["get", "opacity"], 1]] } });
        }
        setMapReady(true);
      });
      mapRef.current = map;
    })();
    return () => {
      cancelled = true;
      vehiclesRef.current.forEach(marker => marker.remove());
      vehiclesRef.current.clear();
      markersRef.current.forEach(marker => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || simulating) return;
    setLineSource(map, "routes", routeData);
    setLineSource(map, "baseline-routes", baselineData);
    setLineSource(map, "route-ghost", emptyLines);
    if (map.getLayer("baseline-routes")) map.setLayoutProperty("baseline-routes", "visibility", compare && routingEnabled ? "visible" : "none");
  }, [routeData, baselineData, compare, routingEnabled, simulating, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];
    void import("maplibre-gl").then(({ Marker }) => {
      if (!mapRef.current) return;
      if (!simulating) {
        markerEngineers.forEach(engineer => {
          const el = markerButton(`engineer-map-marker${selectedEngineerId === engineer.id ? " selected" : ""}`, engineer.initials, engineer.color, engineer.name, () => onSelectEngineer(engineer.id));
          markersRef.current.push(new Marker({ element: el }).setLngLat(engineer.start).addTo(mapRef.current!));
        });
      }
      markerJobs.forEach((job, index) => {
        if (!job.engineerId && routingEnabled) return;
        const engineer = engineers.find(item => item.id === job.engineerId);
        const color = engineer?.color ?? "#6b7280";
        const el = markerButton(`job-map-marker${selectedJobId === job.id ? " selected" : ""}`, String(index + 1), color, `№ ${job.id} · ${job.address}`, () => onSelectJob(job.id));
        markersRef.current.push(new Marker({ element: el }).setLngLat(job.coordinates).addTo(mapRef.current!));
      });
    });
  }, [compare, routingEnabled, simulating, selectedEngineerId, selectedJobId, markerEngineers, markerJobs, engineers, onSelectEngineer, onSelectJob, mapReady]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const job = visibleJobs.find(item => item.id === selectedJobId);
    if (job) {
      map.flyTo({ center: job.coordinates, zoom: 16, duration: 500 });
      return;
    }
    const engineer = engineers.find(item => item.id === selectedEngineerId);
    if (engineer) {
      void fitCoords(routeFor(engineer));
      return;
    }
    void fitVisible();
  }, [selectedJobId, selectedEngineerId, visibleJobs, engineers, routeFor, fitCoords, fitVisible]);
  const simPlayingRef = useRef(simPlaying);
  const simSpeedRef = useRef(simSpeed);
  const simTimeRef = useRef(simTime);
  const simEndRef = useRef(simEnd);
  simPlayingRef.current = simPlaying;
  simSpeedRef.current = simSpeed;
  simTimeRef.current = simTime;
  simEndRef.current = simEnd;
  const fleetRef = useRef({ visibleEngineers, visibleJobs, engineers, selectedEngineerId, planByEngineer, routeFor, onSelectEngineer, onSimTime, onSimPlaying });
  fleetRef.current = { visibleEngineers, visibleJobs, engineers, selectedEngineerId, planByEngineer, routeFor, onSelectEngineer, onSimTime, onSimPlaying };
  useEffect(() => {
    const map = mapRef.current;
    const clearVehicles = () => {
      vehiclesRef.current.forEach(marker => marker.remove());
      vehiclesRef.current.clear();
    };
    if (!map || !loadedRef.current || simTime == null) {
      clearVehicles();
      if (clockRef.current) clockRef.current.textContent = "";
      if (actionBoxRef.current) actionBoxRef.current.hidden = true;
      if (map && loadedRef.current) setLineSource(map, "route-ghost", emptyLines);
      return;
    }
    let cancelled = false;
    let frame = 0;
    let last = performance.now();
    let emit = 0;
    let clock = simTime;
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
      if (action.phase === "travel") actionMetaRef.current.textContent = `До прибытия ${remainingLabel(action.remaining)} · заявка ${action.index} из ${action.total}`;
      else if (action.phase === "wait") actionMetaRef.current.textContent = `До начала окна ${remainingLabel(action.remaining)}`;
      else if (action.phase === "service") actionMetaRef.current.textContent = `Осталось ${remainingLabel(action.remaining)}`;
      else if (action.phase === "done") actionMetaRef.current.textContent = "Маршрут инженера закрыт";
      else actionMetaRef.current.textContent = movers.length > 1 ? `${movers.length} инженеров на карте` : "Старт с базы";
    };
    const paint = (Marker: typeof import("maplibre-gl").Marker, time: number) => {
      const host = mapRef.current;
      if (!host) return;
      const { visibleEngineers: moversSource, visibleJobs: jobs, selectedEngineerId: selected, planByEngineer: plans, routeFor: coordsOf, onSelectEngineer: select } = fleetRef.current;
      const movers = moversSource.filter(engineer => coordsOf(engineer).length >= 2).slice(0, 24);
      const keep = new Set(movers.map(engineer => engineer.id));
      for (const [id, marker] of vehiclesRef.current) {
        if (!keep.has(id)) {
          marker.remove();
          vehiclesRef.current.delete(id);
        }
      }
      const ghosts: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const trails: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      for (const engineer of movers) {
        const coords = coordsOf(engineer);
        const plan = plans.get(engineer.id) ?? null;
        const pose = plan?.stops.length
          ? positionAtSimTime(engineer, plan, jobs, coords, time)
          : { ...sliceByFraction(coords, (time - engineer.shiftStart) / Math.max(1, engineer.shiftEnd - engineer.shiftStart)), done: time >= engineer.shiftEnd };
        const selectedSelf = selected === engineer.id;
        ghosts.push(lineFeature(engineer, coords, selectedSelf, selectedSelf ? 0.28 : 0.14));
        trails.push(lineFeature(engineer, pose.line.length >= 2 ? pose.line : [pose.point, pose.point], selectedSelf, selected && !selectedSelf ? 0.55 : 1));
        let marker = vehiclesRef.current.get(engineer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "route-vehicle-marker";
          el.style.setProperty("--marker", engineer.color);
          el.title = engineer.name;
          el.onclick = () => select(engineer.id);
          marker = new Marker({ element: el, anchor: "center" }).setLngLat(pose.point).addTo(host);
          vehiclesRef.current.set(engineer.id, marker);
        } else {
          marker.setLngLat(pose.point);
        }
      }
      setLineSource(host, "route-ghost", { type: "FeatureCollection", features: ghosts });
      setLineSource(host, "routes", { type: "FeatureCollection", features: trails });
      if (host.getLayer("baseline-routes")) host.setLayoutProperty("baseline-routes", "visibility", "none");
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
    <div ref={containerRef} className="maplibre-host" />
    <MapChrome caption={captionText(routeStatus)} status={routeStatus} clockRef={clockRef} onFit={() => void fitVisible()} onZoomIn={() => mapRef.current?.zoomIn()} onZoomOut={() => mapRef.current?.zoomOut()} />
    <div ref={actionBoxRef} className="playback-action" hidden>
      <strong>Сейчас</strong>
      <p><span ref={actionTextRef} /><button type="button" className="playback-job-id" ref={actionJobRef} onClick={() => { const id = actionJobRef.current?.dataset.job; if (id) onInspectJob(id); }} /></p>
      <small ref={actionMetaRef} />
    </div>
  </div>;
}
