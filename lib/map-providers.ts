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
 * Browser-facing contract for the backend proxy. It keeps third-party services
 * behind our own endpoints, so OSRM can later be replaced by Yandex or FastAPI
 * without changing the map components.
 */
export class BackendRoutingProvider implements RoutingProvider {
  readonly id: "osrm" | "yandex";

  constructor(id: "osrm" | "yandex", private readonly baseUrl = "/api/routing") {
    this.id = id;
  }

  async buildRoute(request: RouteRequest): Promise<RouteResult> {
    const response = await fetch(this.baseUrl, {
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

export class BackendGeocodingProvider implements GeocodingProvider {
  readonly id: "nominatim" | "yandex";

  constructor(id: "nominatim" | "yandex", private readonly baseUrl = "/api/geocode") {
    this.id = id;
  }

  async geocode(address: string): Promise<Coordinate | null> {
    const response = await fetch(`${this.baseUrl}?q=${encodeURIComponent(address)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("Не удалось определить координаты адреса");
    const data = await response.json() as { coordinates: Coordinate };
    return data.coordinates;
  }
}
