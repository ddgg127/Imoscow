export type Coordinate = [longitude: number, latitude: number];

export type TravelMode = "driving" | "walking";

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
 * Contract placeholder for the backend. The browser intentionally does not call
 * public routing/geocoding endpoints yet: keys, caching and rate limits belong
 * in FastAPI. Swap this adapter for OSRM or Yandex without changing map UI.
 */
export class BackendRoutingProvider implements RoutingProvider {
  readonly id: "osrm" | "yandex";

  constructor(id: "osrm" | "yandex", private readonly baseUrl = "/api/routing") {
    this.id = id;
  }

  async buildRoute(request: RouteRequest): Promise<RouteResult> {
    const response = await fetch(`${this.baseUrl}/route`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: this.id, ...request }),
    });
    if (!response.ok) throw new Error("Не удалось построить маршрут");
    return response.json() as Promise<RouteResult>;
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

