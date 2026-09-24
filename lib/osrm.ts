export type Point = [number, number];
export type RoadRouteResult = { geometry: { type: "LineString"; coordinates: Point[] }; distanceMeters: number; durationSeconds: number; provider: "osrm" | "valhalla" | "walking-estimate" };

const OSRM = "https://router.project-osrm.org";
const FOSSGIS = "https://routing.openstreetmap.de";
const UA = { "user-agent": "FieldFlow-Hackathon/1.0" };
const SNAP = 35;
const MAX_TABLE = 90;
const VALHALLA = "https://valhalla1.openstreetmap.de";

const legCache = new Map<string, { geometry: Point[]; distanceMeters: number; durationSeconds: number }>();
const routeCache = new Map<string, { geometry: { type: "LineString"; coordinates: Point[] }; distanceMeters: number; durationSeconds: number; provider: "osrm" | "valhalla" }>();
const tableCache = new Map<string, { distances: Array<Array<number | null>>; durations: Array<Array<number | null>> }>();

export function pointKey(point: Point) {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

function profileOf(mode: unknown) {
  return mode === "walking" ? "foot" : mode === "cycling" ? "bike" : "driving";
}

function routeBases(mode: unknown) {
  if (mode === "walking") return [`${FOSSGIS}/routed-foot`];
  if (mode === "cycling") return [`${FOSSGIS}/routed-bike`];
  return [OSRM, `${FOSSGIS}/routed-car`];
}

export function decodePolyline6(shape: string): Point[] {
  const points: Point[] = [];
  let lat = 0;
  let lon = 0;
  let cursor = 0;
  while (cursor < shape.length) {
    const values: number[] = [];
    for (let axis = 0; axis < 2; axis++) {
      let value = 0;
      let shift = 0;
      let byte: number;
      do {
        if (cursor >= shape.length || shift > 30) throw new Error("Повреждена геометрия Valhalla");
        byte = shape.charCodeAt(cursor++) - 63;
        value |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      values.push(value & 1 ? ~(value >> 1) : value >> 1);
    }
    lat += values[0];
    lon += values[1];
    points.push([lon / 1e6, lat / 1e6]);
  }
  return points;
}

async function valhallaRoute(points: Point[], mode: unknown) {
  const costing = mode === "walking" ? "pedestrian" : mode === "cycling" ? "bicycle" : mode === "transit" ? "multimodal" : "auto";
  const request = { locations: points.map(([lon, lat]) => ({ lon, lat })), costing, units: "kilometers", ...(costing === "multimodal" ? { date_time: { type: 0 } } : {}) };
  const response = await fetch(`${VALHALLA}/route`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-client-id": "fieldflow-hackathon" },
    body: JSON.stringify(request),
    cf: { cacheTtl: 3600, cacheEverything: true },
  } as RequestInit);
  if (!response.ok) throw new Error(`Valhalla route ${response.status}`);
  const data = await response.json() as { trip?: { legs?: Array<{ shape?: string }>; summary?: { length?: number; time?: number } } };
  const legs = data.trip?.legs ?? [];
  if (legs.length !== points.length - 1) throw new Error("Valhalla не вернула все участки маршрута");
  const geometry = legs.flatMap((leg, index) => {
    const coords = decodePolyline6(leg.shape ?? "");
    if (coords.length < 2) throw new Error("Пустой участок Valhalla");
    return index ? coords.slice(1) : coords;
  });
  const distanceMeters = (data.trip?.summary?.length ?? NaN) * 1000;
  const durationSeconds = data.trip?.summary?.time ?? NaN;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) throw new Error("Valhalla не вернула расстояние и время");
  return { geometry: { type: "LineString" as const, coordinates: geometry }, distanceMeters, durationSeconds, provider: "valhalla" as const };
}

async function fetchRoute(path: string, mode: unknown) {
  let lastError: unknown;
  for (const base of routeBases(mode)) {
    try {
      const response = await fetchOsrm(`${base}${path}`);
      if (response.ok) return response;
      lastError = new Error(`OSRM route ${response.status}`);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("Дорожные серверы недоступны");
}

async function fetchOsrm(url: string, attempt = 0): Promise<Response> {
  const response = await fetch(url, { headers: UA, cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
  if ((response.status === 429 || response.status >= 500) && attempt < 2) {
    await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));
    return fetchOsrm(url, attempt + 1);
  }
  return response;
}

export async function osrmNearest(point: Point, mode: unknown = "driving"): Promise<Point> {
  try {
    const response = await fetchRoute(`/nearest/v1/driving/${point[0]},${point[1]}?number=1`, mode);
    const data = await response.json() as { waypoints?: Array<{ location?: Point }> };
    const location = data.waypoints?.[0]?.location;
    return location ? [location[0], location[1]] : point;
  } catch { return point; }
}

export async function osrmLeg(from: Point, to: Point, mode: unknown = "driving") {
  const profile = profileOf(mode);
  const cacheKey = `${profile}:${pointKey(from)}:${pointKey(to)}`;
  const cached = legCache.get(cacheKey);
  if (cached) return cached;
  const qs = `overview=full&geometries=geojson&steps=false&continue_straight=true&approaches=curb;curb&radiuses=${SNAP};${SNAP}`;
  let response: Response;
  try {
    response = await fetchRoute(`/route/v1/driving/${from[0]},${from[1]};${to[0]},${to[1]}?${qs}`, mode);
  } catch {
    const snappedFrom = await osrmNearest(from, mode);
    const snappedTo = await osrmNearest(to, mode);
    response = await fetchRoute(`/route/v1/driving/${snappedFrom[0]},${snappedFrom[1]};${snappedTo[0]},${snappedTo[1]}?overview=full&geometries=geojson&continue_straight=true`, mode);
  }
  const data = await response.json() as { routes?: Array<{ geometry?: { coordinates?: Point[] }; distance: number; duration: number }> };
  const route = data.routes?.[0];
  const geometry = route?.geometry?.coordinates;
  if (!geometry || geometry.length < 2) throw new Error("Пустой участок OSRM");
  const value = { geometry, distanceMeters: route.distance, durationSeconds: route.duration };
  if (legCache.size > 5000) legCache.clear();
  legCache.set(cacheKey, value);
  return value;
}

export async function osrmRouteLegs(points: Point[], mode: unknown = "driving"): Promise<RoadRouteResult> {
  if (mode === "transit") {
    try { return await valhallaRoute(points, mode); }
    catch {
      // The public demo has no guaranteed GTFS coverage. A pedestrian route is
      // visibly marked approximate; never silently substitute a car route.
      const walking = await osrmRouteLegs(points, "walking");
      return { ...walking, provider: "walking-estimate" as const };
    }
  }
  if (points.length > 2) {
    const profile = profileOf(mode);
    const key = `${profile}:${points.map(pointKey).join("|")}`;
    const cached = routeCache.get(key);
    if (cached) return cached;
    const coords = points.map(point => `${point[0]},${point[1]}`).join(";");
    try {
      const response = await fetchRoute(`/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`, mode);
      const data = await response.json() as { routes?: Array<{ geometry?: { coordinates?: Point[] }; distance?: number; duration?: number }> };
      const route = data.routes?.[0];
      const geometry = route?.geometry?.coordinates;
      if (!geometry || geometry.length < 2 || !Number.isFinite(route?.distance) || !Number.isFinite(route?.duration)) throw new Error("Пустой маршрут OSRM");
      const value = { geometry: { type: "LineString" as const, coordinates: geometry }, distanceMeters: route!.distance!, durationSeconds: route!.duration!, provider: "osrm" as const };
      if (routeCache.size > 1000) routeCache.clear();
      routeCache.set(key, value);
      return value;
    } catch {
      const value = await valhallaRoute(points, mode);
      if (routeCache.size > 1000) routeCache.clear();
      routeCache.set(key, value);
      return value;
    }
  }
  const coordinates: Point[] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const leg = await osrmLeg(points[i], points[i + 1], mode).catch(() => null);
    if (!leg) return valhallaRoute(points, mode);
    if (coordinates.length) coordinates.push(...leg.geometry.slice(1));
    else coordinates.push(...leg.geometry);
    distanceMeters += leg.distanceMeters;
    durationSeconds += leg.durationSeconds;
  }
  return { geometry: { type: "LineString" as const, coordinates }, distanceMeters, durationSeconds, provider: "osrm" as const };
}

async function osrmTableBlock(points: Point[], sources: number[], destinations: number[], mode: unknown) {
  const coords = points.map(point => point.join(",")).join(";");
  const response = await fetchRoute(`/table/v1/driving/${coords}?annotations=duration,distance&sources=${sources.join(";")}&destinations=${destinations.join(";")}`, mode);
  if (!response.ok) throw new Error(`OSRM table ${response.status}`);
  return response.json() as Promise<{ distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> }>;
}

export async function osrmTable(points: Point[], mode: unknown = "driving") {
  const cacheKey = `${profileOf(mode)}:${points.map(pointKey).join("|")}`;
  const cached = tableCache.get(cacheKey);
  if (cached) return cached;
  const n = points.length;
  const distances = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
  const durations = Array.from({ length: n }, () => Array<number | null>(n).fill(null));
  const size = n <= MAX_TABLE ? n : 40;
  for (let si = 0; si < n; si += size) {
    const sources = Array.from({ length: Math.min(size, n - si) }, (_, i) => si + i);
    for (let di = 0; di < n; di += size) {
      const destinations = Array.from({ length: Math.min(size, n - di) }, (_, i) => di + i);
      const block = await osrmTableBlock(points, sources, destinations, mode);
      sources.forEach((row, i) => {
        destinations.forEach((col, j) => {
          distances[row][col] = block.distances?.[i]?.[j] ?? null;
          durations[row][col] = block.durations?.[i]?.[j] ?? null;
        });
      });
    }
  }
  const value = { distances, durations };
  if (tableCache.size > 40) tableCache.clear();
  tableCache.set(cacheKey, value);
  return value;
}
