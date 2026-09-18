import { NextRequest, NextResponse } from "next/server";
import { osrmTable, type Point } from "@/lib/osrm";

function parsePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 220) return null;
  const points = value.map(item => Array.isArray(item) && item.length === 2 ? [Number(item[0]), Number(item[1])] as Point : null);
  if (points.some(point => !point || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || point[0] < 36 || point[0] > 39 || point[1] < 54 || point[1] > 57)) return null;
  return points as Point[];
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { points?: unknown; mode?: unknown } | null;
  const points = parsePoints(body?.points);
  if (!points) return NextResponse.json({ error: "Некорректные координаты матрицы" }, { status: 400 });
  try {
    const table = await osrmTable(points, body?.mode);
    return NextResponse.json({ ...table, provider: "osrm" });
  } catch {
    return NextResponse.json({ error: "Матрица OSRM недоступна" }, { status: 502 });
  }
}
