import { NextRequest, NextResponse } from "next/server";
import { heuristicServerResponse, type SolverPayload, type SolverResponse } from "@/lib/server-solver";

function validPayload(value: unknown): value is SolverPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SolverPayload>;
  const n = body.matrix?.points?.length ?? 0;
  return Array.isArray(body.engineers) && body.engineers.length > 0 && body.engineers.length <= 500
    && Array.isArray(body.jobs) && body.jobs.length <= 1000
    && Number.isFinite(body.speedKmh) && Number(body.speedKmh) >= 5 && Number(body.speedKmh) <= 200
    && n >= 2 && n <= 1500
    && body.matrix!.distancesKm.length === n && body.matrix!.durationsMin.length === n
    && body.matrix!.distancesKm.every(row => Array.isArray(row) && row.length === n)
    && body.matrix!.durationsMin.every(row => Array.isArray(row) && row.length === n);
}

async function callOrTools(payload: SolverPayload): Promise<SolverResponse | null> {
  const configured = String(process.env.SOLVER_URL ?? "").trim();
  const base = (configured || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "")).replace(/\/$/, "");
  if (!base) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${base}/solve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new Error(`OR-Tools service ${response.status}`);
    return await response.json() as SolverResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!validPayload(body)) return NextResponse.json({ error: "Некорректные данные solver" }, { status: 400 });
  try {
    const external = await callOrTools(body);
    return NextResponse.json(external ?? heuristicServerResponse(body));
  } catch (error) {
    const fallback = heuristicServerResponse(body);
    return NextResponse.json({ ...fallback, warning: error instanceof Error ? error.message : "OR-Tools unavailable" });
  }
}
