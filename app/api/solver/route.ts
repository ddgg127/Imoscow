import { NextRequest, NextResponse } from "next/server";
import { type SolverPayload, type SolverResponse } from "@/lib/server-solver";

function validPayload(value: unknown): value is SolverPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<SolverPayload>;
  const n = body.matrix?.points?.length ?? 0;
  return Array.isArray(body.engineers) && body.engineers.length > 0 && body.engineers.length <= 500
    && Array.isArray(body.jobs) && body.jobs.length <= 1000
    && Number.isFinite(body.speedKmh) && Number(body.speedKmh) >= 5 && Number(body.speedKmh) <= 200
    && (body.forcedAssignments == null || (typeof body.forcedAssignments === "object"
      && Object.entries(body.forcedAssignments).every(([jobId, engineerId]) => Boolean(jobId) && typeof engineerId === "string" && Boolean(engineerId))))
    && n >= 2 && n <= 1500
    && body.matrix!.distancesKm.length === n && body.matrix!.durationsMin.length === n
    && body.matrix!.distancesKm.every(row => Array.isArray(row) && row.length === n)
    && body.matrix!.durationsMin.every(row => Array.isArray(row) && row.length === n);
}

function solverBase() {
  const configured = String(process.env.SOLVER_URL ?? "").trim();
  return (configured || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "")).replace(/\/$/, "");
}

async function callOrTools(payload: SolverPayload): Promise<SolverResponse> {
  const base = solverBase();
  if (!base) throw new Error("SOLVER_URL не настроен: расчёт без OR-Tools запрещён");
  const controller = new AbortController();
  // Free Render instances can need about a minute to wake after inactivity.
  // Keep the request bounded, but do not reject the first real calculation
  // before the mandatory OR-Tools service has had a chance to start.
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(`${base}/solve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new Error(`OR-Tools service ${response.status}`);
    const result = await response.json() as SolverResponse;
    if (result.engine !== "ortools") throw new Error("Внешний сервис не подтвердил движок OR-Tools");
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!validPayload(body)) return NextResponse.json({ error: "Некорректные данные solver" }, { status: 400 });
  try {
    return NextResponse.json(await callOrTools(body));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OR-Tools недоступен", engine: "unavailable" }, { status: 503 });
  }
}

export async function GET() {
  const base = solverBase();
  if (!base) return NextResponse.json({ status: "unavailable", solver: "ortools", error: "SOLVER_URL не настроен" }, { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 70_000);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    const health = await response.json() as { status?: string; solver?: string };
    if (!response.ok || health.status !== "ok" || health.solver !== "ortools") throw new Error("OR-Tools health-check не подтверждён");
    return NextResponse.json({ status: "ok", solver: "ortools" });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", solver: "ortools", error: error instanceof Error ? error.message : "Health-check failed" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
