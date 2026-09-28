import { NextRequest, NextResponse } from "next/server";
import { type SolverPayload, type SolverResponse } from "@/lib/server-solver";
import { createSolverServiceClient } from "@/lib/solver-service";

const solverClient = createSolverServiceClient();

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
  return (configured || (process.env.NODE_ENV === "development" ? "http://127.0.0.1:8008" : "")).replace(/\/$/, "");
}

async function callOrTools(payload: SolverPayload, signal: AbortSignal): Promise<SolverResponse> {
  const base = solverBase();
  if (!base) throw new Error("SOLVER_URL не настроен: расчёт без OR-Tools запрещён");
  return solverClient.solve(base, payload, signal);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!validPayload(body)) return NextResponse.json({ error: "Некорректные данные solver" }, { status: 400 });
  try {
    return NextResponse.json(await callOrTools(body, request.signal));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OR-Tools недоступен", engine: "unavailable" }, { status: 503 });
  }
}

export async function GET() {
  const base = solverBase();
  if (!base) return NextResponse.json({ status: "unavailable", solver: "ortools", error: "SOLVER_URL не настроен" }, { status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    await solverClient.health(base, controller.signal);
    return NextResponse.json({ status: "ok", solver: "ortools", deployment: process.env.RENDER_GIT_COMMIT ?? null });
  } catch (error) {
    return NextResponse.json({ status: "unavailable", solver: "ortools", error: error instanceof Error ? error.message : "Health-check failed" }, { status: 503 });
  } finally {
    clearTimeout(timeout);
  }
}
