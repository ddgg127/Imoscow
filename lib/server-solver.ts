import { coordKey, optimizeVrptw, resultFromRouteOrder, uniquePoints, type Engineer, type Job, type OptimizationResult, type TravelMatrix } from "./vrptw.ts";
import type { DispatchEvent } from "./temporal-replan.ts";

export type SolverEngine = "ortools" | "heuristic-server" | "heuristic-browser";
export type SolverRouteOrder = { engineerId: string; jobIds: string[] };
export type SolverResponse = { engine: SolverEngine; routes: SolverRouteOrder[]; droppedJobIds: string[]; runtimeMs: number };

export type SolverPayload = {
  engineers: Engineer[];
  jobs: Job[];
  speedKmh: number;
  urgentId?: string;
  eventTime?: number;
  eventType?: DispatchEvent["type"];
  forcedAssignments?: Record<string, string>;
  previousAppointments?: Record<string, { engineerId: string; start: number }>;
  timeLimitSeconds?: number;
  matrix: { points: [number, number][]; distancesKm: number[][]; durationsMin: number[][] };
  modeMatrices?: Record<string, { points: [number, number][]; distancesKm: number[][]; durationsMin: number[][] }>;
};

export function createSolverPayload(engineers: Engineer[], jobs: Job[], speedKmh: number, travel: TravelMatrix, urgentId?: string, forcedAssignments?: Record<string, string>, event?: DispatchEvent, previous?: OptimizationResult): SolverPayload {
  const points = uniquePoints(engineers, jobs);
  const dense = (matrix: TravelMatrix) => ({ points, distancesKm: points.map(from => points.map(to => Number(matrix.distanceKm(from, to).toFixed(4)))), durationsMin: points.map(from => points.map(to => Number(matrix.durationMin(from, to).toFixed(3)))) });
  const modeMatrices: SolverPayload["modeMatrices"] = {};
  if (travel.forTransport) {
    if (engineers.some(engineer => ["Пешком", "Пешеход"].includes(engineer.transport))) modeMatrices.walking = dense(travel.forTransport("Пешком"));
    if (engineers.some(engineer => engineer.transport === "Велосипед")) modeMatrices.cycling = dense(travel.forTransport("Велосипед"));
  }
  const remaining = new Set(jobs.map(job => job.id));
  const previousAppointments = previous ? Object.fromEntries(previous.routes.flatMap(route => route.stops
    .filter(stop => remaining.has(stop.jobId))
    .map(stop => [stop.jobId, { engineerId: route.engineerId, start: stop.start }]))) : undefined;
  return { engineers, jobs, speedKmh, urgentId, eventTime: event?.time, eventType: event?.type, forcedAssignments, previousAppointments, timeLimitSeconds: forcedAssignments ? 8 : 12, matrix: dense(travel), modeMatrices };
}

export function travelFromSolverPayload(payload: SolverPayload): TravelMatrix {
  const index = new Map(payload.matrix.points.map((point, i) => [coordKey(point), i]));
  const lookup = (table: number[][], from: [number, number], to: [number, number]) => {
    const i = index.get(coordKey(from));
    const j = index.get(coordKey(to));
    if (i == null || j == null || !Number.isFinite(table[i]?.[j])) throw new Error("Solver matrix does not contain a required point");
    return table[i][j];
  };
  const matrixFor = (transport: string) => transport === "Пешком" || transport === "Пешеход" ? payload.modeMatrices?.walking ?? payload.matrix : transport === "Велосипед" ? payload.modeMatrices?.cycling ?? payload.matrix : payload.matrix;
  const wrap = (matrix: SolverPayload["matrix"]): TravelMatrix => ({
    distanceKm: (from, to) => lookup(matrix.distancesKm, from, to),
    durationMin: (from, to) => lookup(matrix.durationsMin, from, to),
    knows: (from, to) => index.has(coordKey(from)) && index.has(coordKey(to)),
  });
  return { ...wrap(payload.matrix), forTransport: transport => wrap(matrixFor(transport)) };
}

export function heuristicServerResponse(payload: SolverPayload): SolverResponse {
  const travel = travelFromSolverPayload(payload);
  const result = optimizeVrptw(payload.engineers, payload.jobs, { speedKmh: payload.speedKmh, travel, innerBudget: 180, zoneBudget: 600 });
  const assigned = new Set(result.routes.flatMap(route => route.stops.map(stop => stop.jobId)));
  return {
    engine: "heuristic-server",
    routes: result.routes.map(route => ({ engineerId: route.engineerId, jobIds: route.stops.map(stop => stop.jobId) })),
    droppedJobIds: payload.jobs.filter(job => !assigned.has(job.id)).map(job => job.id),
    runtimeMs: result.runtimeMs,
  };
}

function validResponse(value: unknown): value is SolverResponse {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SolverResponse>;
  return item.engine === "ortools" && Array.isArray(item.routes)
    && item.routes.every(route => typeof route?.engineerId === "string" && Array.isArray(route.jobIds) && route.jobIds.every(id => typeof id === "string"));
}

export async function solveVrptwServer(engineers: Engineer[], jobs: Job[], speedKmh: number, travel: TravelMatrix, urgentId?: string, event?: DispatchEvent, previous?: OptimizationResult): Promise<{ result: OptimizationResult; engine: "ortools" }> {
  const payload = createSolverPayload(engineers, jobs, speedKmh, travel, urgentId, undefined, event, previous);
  const response = await fetch("/api/solver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const server = await response.json().catch(() => null) as (SolverResponse & { error?: string }) | null;
  if (!response.ok) throw new Error(server?.error ?? `OR-Tools API ${response.status}`);
  if (!validResponse(server)) throw new Error("Сервер не подтвердил результат OR-Tools");
  const result = resultFromRouteOrder(engineers, jobs, server.routes, { speedKmh, travel });
  result.runtimeMs = Math.round((server.runtimeMs + result.runtimeMs) * 10) / 10;
  return { result, engine: "ortools" };
}

export async function solveCounterfactualServer(engineers: Engineer[], jobs: Job[], speedKmh: number, travel: TravelMatrix, jobId: string, engineerId: string): Promise<OptimizationResult> {
  const payload = createSolverPayload(engineers, jobs, speedKmh, travel, undefined, { [jobId]: engineerId });
  const response = await fetch("/api/solver", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const server = await response.json().catch(() => null) as (SolverResponse & { error?: string }) | null;
  if (!response.ok) throw new Error(server?.error ?? `OR-Tools API ${response.status}`);
  if (!validResponse(server)) throw new Error("Контрфактический расчёт не подтверждён OR-Tools");
  const result = resultFromRouteOrder(engineers, jobs, server.routes, { speedKmh, travel });
  result.runtimeMs = Math.round((server.runtimeMs + result.runtimeMs) * 10) / 10;
  return result;
}
