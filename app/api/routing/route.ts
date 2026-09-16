import { NextRequest, NextResponse } from "next/server";

type Point = [number, number];

function parsePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 25) return null;
  const points = value.map(item => Array.isArray(item) && item.length === 2 ? [Number(item[0]), Number(item[1])] as Point : null);
  if (points.some(point => !point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 36 || point[0] > 39 || point[1] < 54 || point[1] > 57)) return null;
  return points as Point[];
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { points?: unknown; mode?: unknown } | null;
  const points = parsePoints(body?.points);
  if (!points) return NextResponse.json({ error: "Некорректные координаты" }, { status: 400 });

  const profile = body?.mode === "walking" ? "foot" : "driving";
  const coordinates = points.map(point => point.join(",")).join(";");
  const url = `https://router.project-osrm.org/route/v1/${profile}/${coordinates}?overview=full&geometries=geojson&steps=false`;

  try {
    const response = await fetch(url, { headers: { "user-agent": "FieldFlow-Hackathon/1.0" }, cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
    if (!response.ok) throw new Error(`OSRM ${response.status}`);
    const data = await response.json() as { routes?: Array<{ geometry: GeoJSON.LineString; distance: number; duration: number }> };
    const route = data.routes?.[0];
    if (!route) throw new Error("Маршрут не найден");
    return NextResponse.json({ geometry: route.geometry, distanceMeters: route.distance, durationSeconds: route.duration, provider: "osrm" });
  } catch {
    return NextResponse.json({ geometry: { type: "LineString", coordinates: points }, distanceMeters: 0, durationSeconds: 0, provider: "fallback" }, { status: 200 });
  }
}

