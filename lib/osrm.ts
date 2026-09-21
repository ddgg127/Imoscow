export type Point = [number, number];

const OSRM = "https://router.project-osrm.org";
const UA = { "user-agent": "FieldFlow-Hackathon/1.0" };
const SNAP = 35;
const MAX_TABLE = 90;

const legCache = new Map<string, { geometry: Point[]; distanceMeters: number; durationSeconds: number }>();
const routeCache = new Map<string, { geometry: { type: "LineString"; coordinates: Point[] }; distanceMeters: number; durationSeconds: number; provider: "osrm" }>();
const tableCache = new Map<string, { distances: Array<Array<number | null>>; durations: Array<Array<number | null>> }>();

export function pointKey(point: Point) {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

function profileOf(mode: unknown) {
  return mode === "walking" ? "foot" : "driving";
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
  const url = `${OSRM}/nearest/v1/${profileOf(mode)}/${point[0]},${point[1]}?number=1`;
  const response = await fetchOsrm(url);
  if (!response.ok) return point;
  const data = await response.json() as { waypoints?: Array<{ location?: Point }> };
  const location = data.waypoints?.[0]?.location;
  return location ? [location[0], location[1]] : point;
}

export async function osrmLeg(from: Point, to: Point, mode: unknown = "driving") {
  const profile = profileOf(mode);
  const cacheKey = `${profile}:${pointKey(from)}:${pointKey(to)}`;
  const cached = legCache.get(cacheKey);
  if (cached) return cached;
  const qs = `overview=full&geometries=geojson&steps=false&continue_straight=true&approaches=curb;curb&radiuses=${SNAP};${SNAP}`;
  let response = await fetchOsrm(`${OSRM}/route/v1/${profile}/${from[0]},${from[1]};${to[0]},${to[1]}?${qs}`);
  if (!response.ok) {
    const snappedFrom = await osrmNearest(from, mode);
    const snappedTo = await osrmNearest(to, mode);
    response = await fetchOsrm(`${OSRM}/route/v1/${profile}/${snappedFrom[0]},${snappedFrom[1]};${snappedTo[0]},${snappedTo[1]}?overview=full&geometries=geojson&continue_straight=true`);
  }
  if (!response.ok) throw new Error(`OSRM leg ${response.status}`);
  const data = await response.json() as { routes?: Array<{ geometry?: { coordinates?: Point[] }; distance: number; duration: number }> };
  const route = data.routes?.[0];
  const geometry = route?.geometry?.coordinates;
  if (!geometry || geometry.length < 2) throw new Error("Пустой участок OSRM");
  const value = { geometry, distanceMeters: route.distance, durationSeconds: route.duration };
  if (legCache.size > 5000) legCache.clear();
  legCache.set(cacheKey, value);
  return value;
}

export async function osrmRouteLegs(points: Point[], mode: unknown = "driving") {
  if (points.length > 2) {
    const profile = profileOf(mode);
    const key = `${profile}:${points.map(pointKey).join("|")}`;
    const cached = routeCache.get(key);
    if (cached) return cached;
    const coords = points.map(point => `${point[0]},${point[1]}`).join(";");
    const radiuses = points.map(() => "100").join(";");
    const response = await fetchOsrm(`${OSRM}/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=false&radiuses=${radiuses}`);
    if (!response.ok) throw new Error(`OSRM route ${response.status}`);
    const data = await response.json() as { routes?: Array<{ geometry?: { coordinates?: Point[] }; distance?: number; duration?: number }> };
    const route = data.routes?.[0];
    const geometry = route?.geometry?.coordinates;
    if (!geometry || geometry.length < 2 || !Number.isFinite(route?.distance) || !Number.isFinite(route?.duration)) throw new Error("Пустой маршрут OSRM");
    const value = { geometry: { type: "LineString" as const, coordinates: geometry }, distanceMeters: route!.distance!, durationSeconds: route!.duration!, provider: "osrm" as const };
    if (routeCache.size > 1000) routeCache.clear();
    routeCache.set(key, value);
    return value;
  }
  const coordinates: Point[] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const leg = await osrmLeg(points[i], points[i + 1], mode);
    if (coordinates.length) coordinates.push(...leg.geometry.slice(1));
    else coordinates.push(...leg.geometry);
    distanceMeters += leg.distanceMeters;
    durationSeconds += leg.durationSeconds;
  }
  return { geometry: { type: "LineString" as const, coordinates }, distanceMeters, durationSeconds, provider: "osrm" as const };
}

async function osrmTableBlock(points: Point[], sources: number[], destinations: number[], mode: unknown) {
  const coords = points.map(point => point.join(",")).join(";");
  const url = `${OSRM}/table/v1/${profileOf(mode)}/${coords}?annotations=duration,distance&sources=${sources.join(";")}&destinations=${destinations.join(";")}`;
  const response = await fetchOsrm(url);
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
