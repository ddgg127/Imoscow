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
    const response = await fetch(`${this.baseUrl}/matrix`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: this.id, points, mode }),
    });
    if (!response.ok) throw new Error("Не удалось получить матрицу времени");
    return response.json() as Promise<MatrixResult>;
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
