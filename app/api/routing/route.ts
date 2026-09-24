import { NextRequest, NextResponse } from "next/server";
import { osrmRouteLegs, type Point } from "@/lib/osrm";

function parsePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 80) return null;
  const points = value.map(item => Array.isArray(item) && item.length === 2 ? [Number(item[0]), Number(item[1])] as Point : null);
  if (points.some(point => !point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 36 || point[0] > 39 || point[1] < 54 || point[1] > 57)) return null;
  return points as Point[];
}

function flattenCoords(value: unknown, acc: Point[] = []): Point[] {
  if (!Array.isArray(value) || value.length === 0) return acc;
  if (typeof value[0] === "number" && typeof value[1] === "number") {
    acc.push([Number(value[0]), Number(value[1])]);
    return acc;
  }
  for (const item of value) flattenCoords(item, acc);
  return acc;
}

function asLine(coordinates: Point[]): GeoJSON.LineString {
  return { type: "LineString", coordinates };
}

function yandexGeometry(data: Record<string, unknown>): Point[] | null {
  const direct = flattenCoords((data as { geometry?: { coordinates?: unknown } }).geometry?.coordinates);
  if (direct.length >= 2) return direct;
  const route = data.route as { legs?: Array<{ steps?: Array<{ polyline?: { points?: unknown }; geometry?: { coordinates?: unknown } }> }>; geometry?: { coordinates?: unknown } } | undefined;
  if (route?.geometry?.coordinates) {
    const coords = flattenCoords(route.geometry.coordinates);
    if (coords.length >= 2) return coords;
  }
  const fromLegs = route?.legs?.flatMap(leg => leg.steps?.flatMap(step => flattenCoords(step.geometry?.coordinates ?? step.polyline?.points)) ?? []) ?? [];
  return fromLegs.length >= 2 ? fromLegs as Point[] : null;
}

async function yandexRoute(points: Point[], apiKey: string, mode: unknown) {
  const url = new URL("https://api.routing.yandex.net/v2/route");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("waypoints", points.map(point => `${point[0]},${point[1]}`).join("|"));
  url.searchParams.set("mode", mode === "walking" ? "walking" : "driving");
  const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0" } });
  if (!response.ok) throw new Error(`Yandex router ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  const coordinates = yandexGeometry(data);
  if (!coordinates) throw new Error("Пустой ответ Яндекс.Маршрутов");
  const distance = Number((data as { route?: { length?: number } }).route?.length ?? 0);
  const duration = Number((data as { route?: { duration?: number } }).route?.duration ?? 0);
  return { geometry: asLine(coordinates), distanceMeters: distance, durationSeconds: duration, provider: "yandex" };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { points?: unknown; mode?: unknown; provider?: unknown } | null;
  const points = parsePoints(body?.points);
  if (!points) return NextResponse.json({ error: "Некорректные координаты" }, { status: 400 });
  const apiKey = String(process.env.YANDEX_ROUTING_API_KEY ?? "").trim();
  if (body?.provider === "yandex" && apiKey && (body.mode === "driving" || body.mode === "walking")) {
    try {
      return NextResponse.json(await yandexRoute(points, apiKey, body.mode));
    } catch {
      /* OSRM still follows real roads when Yandex Routing is unavailable */
    }
  }
  try {
    return NextResponse.json(await osrmRouteLegs(points, body?.mode));
  } catch {
    return NextResponse.json({ error: "Не удалось построить дорогу по графу OSM" }, { status: 502 });
  }
}
