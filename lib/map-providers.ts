export type Coordinate = [longitude: number, latitude: number];

export type TravelMode = "driving" | "walking" | "cycling" | "transit";

export interface RouteRequest {
  points: Coordinate[];
  mode: TravelMode;
}

export interface RouteResult {
  geometry: GeoJSON.LineString;
  distanceMeters: number;
  durationSeconds: number;
  provider: string;
}

/** Public read-only road graph as a browser fallback when the app proxy is unreachable. */
export async function publicOsmRoute(request: RouteRequest): Promise<RouteResult> {
  if (request.mode === "transit") {
    const estimate = await publicOsmRoute({ ...request, mode: "walking" });
    return { ...estimate, provider: "walking-estimate" };
  }
  const bases = request.mode === "walking" ? ["https://routing.openstreetmap.de/routed-foot"]
    : request.mode === "cycling" ? ["https://routing.openstreetmap.de/routed-bike"]
    : ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"];
  const path = request.points.map(point => point.join(",")).join(";");
  for (const base of bases) {
    try {
      const response = await fetch(`${base}/route/v1/driving/${path}?overview=full&geometries=geojson&steps=false`, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) continue;
      const data = await response.json() as { routes?: Array<{ geometry?: GeoJSON.LineString; distance?: number; duration?: number }> };
      const route = data.routes?.[0];
      if (route?.geometry?.coordinates?.length && route.geometry.coordinates.length >= 2 && Number.isFinite(route.distance) && Number.isFinite(route.duration)) {
        return { geometry: route.geometry, distanceMeters: route.distance!, durationSeconds: route.duration!, provider: "osrm" };
      }
    } catch { /* Try the next public OSM router. */ }
  }
  if (request.points.length > 2) {
    const legs: RouteResult[] = [];
    for (let offset = 1; offset < request.points.length; offset += 4) {
      const batch = request.points.slice(offset, offset + 4);
      legs.push(...await Promise.all(batch.map((point, index) => publicOsmRoute({ mode: request.mode, points: [request.points[offset + index - 1], point] }))));
    }
    return { geometry: { type: "LineString", coordinates: legs.flatMap((leg, index) => index ? leg.geometry.coordinates.slice(1) : leg.geometry.coordinates) }, distanceMeters: legs.reduce((sum, leg) => sum + leg.distanceMeters, 0), durationSeconds: legs.reduce((sum, leg) => sum + leg.durationSeconds, 0), provider: "osrm" };
  }
  throw new Error("Публичные дорожные маршрутизаторы недоступны");
}

export interface MatrixResult {
  durations: Array<Array<number | null>>;
  distances: Array<Array<number | null>>;
  provider: string;
}

/** Browser fallback for deployments whose server cannot reach public OSRM. */
export async function publicOsmMatrix(points: Coordinate[], mode: TravelMode): Promise<MatrixResult> {
  const bases = mode === "walking" ? ["https://routing.openstreetmap.de/routed-foot"]
    : mode === "cycling" ? ["https://routing.openstreetmap.de/routed-bike"]
    : ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"];
  const size = points.length;
  const blockSize = size <= 90 ? size : 40;
  for (const base of bases) {
    try {
      const distances = Array.from({ length: size }, () => Array<number | null>(size).fill(null));
      const durations = Array.from({ length: size }, () => Array<number | null>(size).fill(null));
      const coordinates = points.map(point => point.join(",")).join(";");
      for (let from = 0; from < size; from += blockSize) {
        const sources = Array.from({ length: Math.min(blockSize, size - from) }, (_, index) => from + index);
        for (let to = 0; to < size; to += blockSize) {
          const destinations = Array.from({ length: Math.min(blockSize, size - to) }, (_, index) => to + index);
          const url = `${base}/table/v1/driving/${coordinates}?annotations=duration,distance&sources=${sources.join(";")}&destinations=${destinations.join(";")}`;
          const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(`OSRM table ${response.status}`);
          const table = await response.json() as { code?: string; distances?: Array<Array<number | null>>; durations?: Array<Array<number | null>> };
          if (table.code !== "Ok" || !table.distances || !table.durations) throw new Error("Некорректная дорожная матрица");
          sources.forEach((row, i) => destinations.forEach((col, j) => {
            distances[row][col] = table.distances?.[i]?.[j] ?? null;
            durations[row][col] = table.durations?.[i]?.[j] ?? null;
          }));
        }
      }
      return { distances, durations, provider: "browser-osrm" };
    } catch { /* Try the next public road graph. */ }
  }
  throw new Error("Публичные дорожные матрицы недоступны из браузера");
}

export interface RoutingProvider {
  readonly id: "osrm" | "yandex";
  buildRoute(request: RouteRequest): Promise<RouteResult>;
  buildMatrix(points: Coordinate[], mode: TravelMode): Promise<MatrixResult>;
}

export interface GeocodingProvider {
  readonly id: "nominatim" | "yandex";
  geocode(address: string): Promise<Coordinate | null>;
}

/**
 * Browser-facing contract for the backend proxy. It keeps third-party services
 * behind our own endpoints, so OSRM can later be replaced by Yandex or FastAPI
 * without changing the map components.
 */
export class BackendRoutingProvider implements RoutingProvider {
  readonly id: "osrm" | "yandex";
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(id: "osrm" | "yandex", baseUrl = "/api/routing", apiKey = "") {
    this.id = id;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async buildRoute(request: RouteRequest): Promise<RouteResult> {
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: this.id, apiKey: this.apiKey || undefined, ...request }),
        signal: AbortSignal.timeout(18000),
      });
      if (response.ok) return response.json() as Promise<RouteResult>;
    } catch { /* Browser can still reach a public router when the proxy cannot. */ }
    return publicOsmRoute(request);
  }

  async buildMatrix(points: Coordinate[], mode: TravelMode): Promise<MatrixResult> {
    try {
      const response = await fetch(`${this.baseUrl}/matrix`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: this.id, points, mode }),
        signal: AbortSignal.timeout(18000),
      });
      if (response.ok) return response.json() as Promise<MatrixResult>;
    } catch { /* Browser may reach public OSRM when the server cannot. */ }
    return publicOsmMatrix(points, mode);
  }
}

export class BackendGeocodingProvider implements GeocodingProvider {
  readonly id: "nominatim" | "yandex";
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(id: "nominatim" | "yandex", baseUrl = "/api/geocode", apiKey = "") {
    this.id = id;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async geocode(address: string): Promise<Coordinate | null> {
    const params = new URLSearchParams({ q: address, provider: this.id });
    if (this.apiKey) params.set("apikey", this.apiKey);
    const response = await fetch(`${this.baseUrl}?${params}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Не удалось определить координаты адреса");
    const data = await response.json() as { coordinates: Coordinate };
    return data.coordinates;
  }
}
