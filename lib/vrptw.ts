import type { Coordinate } from "./map-providers";

export type Region = "Восток" | "Юго-восток" | "Югоцентр";
export type Job = {
  id: string; time: string; windowStart: number; windowEnd: number; area: string; address: string;
  kind: string; tone: string; region: Region; engineerId: string | null; baselineEngineerId: string | null;
  coordinates: Coordinate; risk: boolean; equipment: string; requiredTransport: string; priority: number;
  serviceMinutes: number; source: string; status: string;
};
export type Engineer = {
  id: string; initials: string; name: string; route: string; jobs: number; distance: string; load: number;
  color: string; region: Region; start: Coordinate; skills: string[]; equipment: string[]; transport: string;
  shiftStart: number; shiftEnd: number;
};
export type RouteStop = { jobId: string; arrival: number; start: number; end: number; distanceKm: number; onTime: boolean };
export type RoutePlan = { engineerId: string; stops: RouteStop[]; distanceKm: number; durationMinutes: number; load: number };
export type PlanMetrics = { assigned: number; total: number; unassigned: number; distanceKm: number; slaPercent: number; late: number; utilization: number };
export type ZoneMetric = { name: Region; jobs: number; assigned: number; sla: number; distance: number; baselineDistance: number; engineers: number };
export type OptimizationResult = { jobs: Job[]; routes: RoutePlan[]; baselineRoutes: RoutePlan[]; metrics: PlanMetrics; baseline: PlanMetrics; zones: ZoneMetric[]; runtimeMs: number };
export type TravelMatrix = {
  distanceKm: (a: Coordinate, b: Coordinate) => number;
  durationMin: (a: Coordinate, b: Coordinate) => number;
  knows?: (a: Coordinate, b: Coordinate) => boolean;
};
export type SearchObjective = "fieldflow" | "distance";
export type TracePhase = "insert" | "anneal" | "relocate" | "compact" | "done";
export type TraceRoute = { engineerId: string; color: string; jobIds: string[]; points: Coordinate[] };
export type TraceFrame = {
  step: number;
  phase: TracePhase;
  label: string;
  accepted: boolean;
  distanceKm: number;
  score: number;
  vehicles: number;
  routes: TraceRoute[];
};
export type OptimizeOptions = {
  speedKmh?: number;
  travel?: TravelMatrix;
  seed?: number;
  innerBudget?: number;
  zoneBudget?: number;
  objective?: SearchObjective;
  trace?: SearchTrace;
  skipInsertPolish?: boolean;
};

export const VEHICLE_COST = 140;
export const DISTANCE_WEIGHT = 10;
const SPEED_KMH = 32;
const SLACK = 0.12;
const P0 = 0.8;
const P_STOP = 0.01;
const WAIT_WEIGHT = 0.35;

export class SearchTrace {
  frames: TraceFrame[] = [];
  push(frame: Omit<TraceFrame, "step">) {
    if (this.frames.length >= 800) return;
    this.frames.push({ ...frame, step: this.frames.length });
  }
}

let activeObjective: SearchObjective = "fieldflow";
let activeTrace: SearchTrace | null = null;
export const regions: Region[] = ["Восток", "Юго-восток", "Югоцентр"];
const SCALE_COLORS = ["#7657ff", "#00a89d", "#ff8b3d", "#2d82d7", "#e84f87", "#8b5e34", "#7a9c32", "#d35f45", "#5367c9", "#a04fa4", "#168b67", "#b67b1f"];

export function coordKey(point: Coordinate) {
  return `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
}

export function distanceKm(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function fallbackTravel(speedKmh: number): TravelMatrix {
  return {
    distanceKm: (a, b) => distanceKm(a, b) * 1.35,
    durationMin: (a, b) => distanceKm(a, b) * 1.35 / Math.max(1, speedKmh) * 60,
  };
}

export function travelFromTable(points: Coordinate[], distances: Array<Array<number | null>>, durations: Array<Array<number | null>>, speedKmh: number): TravelMatrix {
  const index = new Map<string, number>();
  points.forEach((point, i) => { if (!index.has(coordKey(point))) index.set(coordKey(point), i); });
  const fallback = fallbackTravel(speedKmh);
  const lookup = (a: Coordinate, b: Coordinate) => {
    if (coordKey(a) === coordKey(b)) return { km: 0, min: 0 };
    const i = index.get(coordKey(a));
    const j = index.get(coordKey(b));
    if (i == null || j == null) return { km: fallback.distanceKm(a, b), min: fallback.durationMin(a, b) };
    const meters = distances[i]?.[j];
    const seconds = durations[i]?.[j];
    return {
      km: meters != null ? meters / 1000 : fallback.distanceKm(a, b),
      min: seconds != null ? seconds / 60 : fallback.durationMin(a, b),
    };
  };
  return {
    distanceKm: (a, b) => lookup(a, b).km,
    durationMin: (a, b) => lookup(a, b).min,
    knows: (a, b) => index.has(coordKey(a)) && index.has(coordKey(b)),
  };
}

export function mergeTravel(parts: TravelMatrix[], speedKmh: number): TravelMatrix {
  const fallback = fallbackTravel(speedKmh);
  if (!parts.length) return fallback;
  const pick = (a: Coordinate, b: Coordinate) => parts.find(part => part.knows?.(a, b)) ?? fallback;
  return {
    distanceKm: (a, b) => pick(a, b).distanceKm(a, b),
    durationMin: (a, b) => pick(a, b).durationMin(a, b),
    knows: (a, b) => parts.some(part => part.knows?.(a, b)),
  };
}

function travelMinutes(a: Coordinate, b: Coordinate, speedKmh: number, travel?: TravelMatrix) {
  return travel ? travel.durationMin(a, b) : distanceKm(a, b) / Math.max(1, speedKmh) * 60;
}

function travelDistance(a: Coordinate, b: Coordinate, travel?: TravelMatrix) {
  return travel ? travel.distanceKm(a, b) : distanceKm(a, b);
}

export function scaleEngineers(source: Engineer[], count: number): Engineer[] {
  const n = Math.max(1, Math.round(count));
  if (!source.length) return [];
  if (n <= source.length) return source.slice(0, n).map(item => ({ ...item, start: [...item.start] as Coordinate, skills: [...item.skills], equipment: [...item.equipment] }));
  const result = source.map(item => ({ ...item, start: [...item.start] as Coordinate, skills: [...item.skills], equipment: [...item.equipment] }));
  for (let i = source.length; i < n; i++) {
    const base = source[i % source.length];
    const wave = Math.floor(i / source.length);
    const angle = i * 2.399963;
    const radius = 0.008 + wave % 12 * 0.004;
    result.push({
      ...base,
      id: `${base.id}-g${i}`,
      name: `${base.name} · ${wave + 1}`,
      route: `Маршрут ${String(i + 1).padStart(2, "0")}`,
      color: SCALE_COLORS[i % SCALE_COLORS.length],
      start: [Number((base.start[0] + Math.cos(angle) * radius).toFixed(5)), Number((base.start[1] + Math.sin(angle) * radius).toFixed(5))],
      skills: [...base.skills],
      equipment: [...base.equipment],
    });
  }
  return result;
}

export function scaleJobs(source: Job[], count: number): Job[] {
  const n = Math.max(0, Math.round(count));
  if (!source.length || n === 0) return [];
  if (n <= source.length) return source.slice(0, n).map(job => ({ ...job, coordinates: [...job.coordinates] as Coordinate }));
  const result = source.map(job => ({ ...job, coordinates: [...job.coordinates] as Coordinate }));
  for (let i = source.length; i < n; i++) {
    const base = source[i % source.length];
    const wave = Math.floor(i / source.length);
    const angle = i * 1.718;
    const radius = 0.006 + wave % 10 * 0.003;
    result.push({
      ...base,
      id: `${base.id}-g${i}`,
      coordinates: [Number((base.coordinates[0] + Math.cos(angle) * radius).toFixed(5)), Number((base.coordinates[1] + Math.sin(angle) * radius).toFixed(5))],
      engineerId: null,
      baselineEngineerId: null,
      source: "Синтетика",
      status: "Новая",
    });
  }
  return result;
}

/** Stretch SLA windows around shared day-bands. Service time stays unchanged. */
export function applyAverageWindows(jobs: Job[], averageMinutes: number): Job[] {
  const dayStart = 480;
  const dayEnd = 1320;
  const daySpan = dayEnd - dayStart;
  const mean = Math.min(daySpan, Math.max(60, Math.round(averageMinutes / 15) * 15));
  const bandCount = Math.max(1, Math.round(daySpan / mean));
  const pitch = bandCount === 1 ? 0 : (daySpan - mean) / (bandCount - 1);
  return jobs.map(job => {
    if (job.source === "Срочная форма") return { ...job, coordinates: [...job.coordinates] as Coordinate };
    const center = (job.windowStart + job.windowEnd) / 2;
    let band = 0;
    let best = Infinity;
    for (let i = 0; i < bandCount; i++) {
      const dist = Math.abs(center - (dayStart + i * pitch + mean / 2));
      if (dist < best) {
        best = dist;
        band = i;
      }
    }
    const width = mean;
    let start = Math.round((dayStart + band * pitch) / 15) * 15;
    let end = start + width;
    if (end > dayEnd) {
      start = dayEnd - width;
      end = dayEnd;
    }
    if (start < dayStart) {
      start = dayStart;
      end = Math.min(dayEnd, start + width);
    }
    return { ...job, coordinates: [...job.coordinates] as Coordinate, windowStart: start, windowEnd: end, time: `${minutesLabel(start)}–${minutesLabel(end)}` };
  });
}

function compatible(engineer: Engineer, job: Job) {
  return engineer.region === job.region && engineer.transport === job.requiredTransport && engineer.equipment.includes(job.equipment) && engineer.skills.includes(job.kind);
}

function simulate(engineer: Engineer, route: Job[], hardWindows = true, speedKmh = SPEED_KMH, travel?: TravelMatrix): RoutePlan | null {
  let point = engineer.start;
  let time = engineer.shiftStart;
  let totalDistance = 0;
  const stops: RouteStop[] = [];
  for (const job of route) {
    const leg = travelDistance(point, job.coordinates, travel);
    const arrival = time + travelMinutes(point, job.coordinates, speedKmh, travel);
    const start = Math.max(arrival, job.windowStart);
    const end = start + job.serviceMinutes;
    if (hardWindows && (start > job.windowEnd || end > engineer.shiftEnd)) return null;
    totalDistance += leg;
    stops.push({ jobId: job.id, arrival, start, end, distanceKm: leg, onTime: start <= job.windowEnd });
    point = job.coordinates;
    time = end;
  }
  return { engineerId: engineer.id, stops, distanceKm: totalDistance, durationMinutes: Math.max(0, time - engineer.shiftStart), load: Math.round(Math.max(0, time - engineer.shiftStart) / (engineer.shiftEnd - engineer.shiftStart) * 100) };
}

function planScore(plan: RoutePlan, engineer: Engineer) {
  if (activeObjective === "distance") return plan.distanceKm;
  const capacity = Math.max(1, engineer.shiftEnd - engineer.shiftStart);
  const slackGap = Math.max(0, plan.durationMinutes - capacity * (1 - SLACK));
  const wait = plan.stops.reduce((sum, stop) => sum + Math.max(0, stop.start - stop.arrival), 0);
  return plan.distanceKm * DISTANCE_WEIGHT + wait * WAIT_WEIGHT + slackGap * 0.45 + plan.durationMinutes * 0.01;
}

function vehiclePenalty() {
  return activeObjective === "distance" ? 0 : VEHICLE_COST;
}

function insertionScore(engineer: Engineer, currentLength: number, currentScore: number, plan: RoutePlan) {
  return planScore(plan, engineer) - currentScore + (currentLength ? 0 : vehiclePenalty());
}

function fleetScore(from: Engineer, fromPlan: RoutePlan, to: Engineer, toPlan: RoutePlan, fromJobs: number, toJobs: number) {
  const vehicles = (fromJobs > 0 ? 1 : 0) + (toJobs > 0 ? 1 : 0);
  return planScore(fromPlan, from) + planScore(toPlan, to) + vehiclePenalty() * vehicles;
}

function emitTrace(phase: TracePhase, label: string, engineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, accepted = true) {
  if (!activeTrace) return;
  let distanceKm = 0;
  let score = 0;
  let vehicles = 0;
  const routes: TraceRoute[] = [];
  for (const engineer of engineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (!route.length) continue;
    const plan = simulate(engineer, route, false, speedKmh, travel);
    if (!plan) continue;
    vehicles += 1;
    distanceKm += plan.distanceKm;
    score += planScore(plan, engineer) + vehiclePenalty();
    routes.push({ engineerId: engineer.id, color: engineer.color, jobIds: route.map(job => job.id), points: [engineer.start, ...route.map(job => job.coordinates)] });
  }
  activeTrace.push({ phase, label, accepted, distanceKm, score, vehicles, routes });
}

function metricsFrom(engineers: Engineer[], jobs: Job[], routes: RoutePlan[]): PlanMetrics {
  const assigned = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = routes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const distance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  const utilization = routes.length ? routes.reduce((sum, route) => sum + route.load, 0) / engineers.length : 0;
  return { assigned, total: jobs.length, unassigned: jobs.length - assigned, distanceKm: distance, slaPercent: assigned ? Math.round((assigned - late) / assigned * 1000) / 10 : 0, late, utilization: Math.round(utilization) };
}

function baselineJobsFor(engineer: Engineer, jobs: Job[]) {
  return jobs.filter(job => job.baselineEngineerId === engineer.id).sort((a, b) => a.windowStart - b.windowStart || a.windowEnd - b.windowEnd);
}

function baselinePlan(engineers: Engineer[], jobs: Job[], speedKmh: number, travel?: TravelMatrix) {
  const routes = engineers.map(engineer => simulate(engineer, baselineJobsFor(engineer, jobs), false, speedKmh, travel)!).filter(route => route.stops.length);
  return { routes, metrics: metricsFrom(engineers, jobs, routes) };
}

export function idleOptimization(engineers: Engineer[], jobs: Job[], speedKmh = SPEED_KMH, travel?: TravelMatrix): OptimizationResult {
  const baseline = travel
    ? baselinePlan(engineers, jobs, speedKmh, travel)
    : { routes: [] as RoutePlan[], metrics: { assigned: 0, total: jobs.length, unassigned: jobs.length, distanceKm: 0, slaPercent: 0, late: 0, utilization: 0 } };
  const zones = regions.map(name => {
    const zoneJobs = jobs.filter(job => job.region === name);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    return { name, jobs: zoneJobs.length, assigned: 0, sla: 0, distance: 0, baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: ids.size };
  });
  return { jobs: jobs.map(job => ({ ...job })), routes: [], baselineRoutes: baseline.routes, metrics: { assigned: 0, total: jobs.length, unassigned: jobs.length, distanceKm: 0, slaPercent: 0, late: 0, utilization: 0 }, baseline: baseline.metrics, zones, runtimeMs: 0 };
}

function hashSeed(jobs: Job[], engineers: Engineer[]) {
  let hash = 2166136261;
  const text = `${jobs.map(job => job.id).join(",")}|${engineers.map(item => item.id).join(",")}`;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function rng(state: { value: number }) {
  state.value = (Math.imul(1664525, state.value) + 1013904223) >>> 0;
  return state.value / 4294967296;
}

function reverseSegment(route: Job[], i: number, j: number) {
  const next = route.slice();
  const mid = next.slice(i + 1, j + 1).reverse();
  next.splice(i + 1, j - i, ...mid);
  return next;
}

function temperature(mu: number, p: number) {
  const probability = Math.min(0.999, Math.max(1e-6, p));
  return Math.max(1e-6, -Math.max(mu, 1e-3) / Math.log(probability));
}

function expectedPositiveDelta(engineer: Engineer, route: Job[], speedKmh: number, travel: TravelMatrix | undefined, random: () => number, samples = 36) {
  const current = simulate(engineer, route, true, speedKmh, travel);
  if (!current || route.length < 3) return 1;
  const base = planScore(current, engineer);
  const positives: number[] = [];
  for (let n = 0; n < samples; n++) {
    const i = Math.floor(random() * Math.max(1, route.length - 2));
    const span = route.length - i - 2;
    if (span <= 0) continue;
    const j = i + 2 + Math.floor(random() * span);
    const plan = simulate(engineer, reverseSegment(route, i, j), true, speedKmh, travel);
    if (!plan) continue;
    const delta = planScore(plan, engineer) - base;
    if (delta > 1e-6) positives.push(delta);
  }
  return positives.length ? positives.reduce((sum, item) => sum + item, 0) / positives.length : 1;
}

type TraceCtx = { engineers: Engineer[]; assignments: Map<string, Job[]> };

function snapshotRoute(engineer: Engineer, route: Job[], speedKmh: number, travel: TravelMatrix | undefined, ctx?: TraceCtx) {
  if (ctx) ctx.assignments.set(engineer.id, route);
  return simulate(engineer, route, true, speedKmh, travel);
}

function annealRoute(engineer: Engineer, route: Job[], speedKmh: number, travel: TravelMatrix | undefined, random: () => number, budget: number, ctx?: TraceCtx) {
  if (route.length < 3) return route.slice();
  let current = route.slice();
  let currentPlan = snapshotRoute(engineer, current, speedKmh, travel, ctx);
  if (!currentPlan) return route.slice();
  let best = current;
  let bestPlan = currentPlan;
  const startedKm = bestPlan.distanceKm;
  if (activeTrace && ctx) emitTrace("anneal", `2-opt старт ${engineer.name}: ${startedKm.toFixed(1)}`, ctx.engineers, ctx.assignments, speedKmh, travel);
  const mu = expectedPositiveDelta(engineer, current, speedKmh, travel, random);
  const tau = Math.max(8, budget / 4);
  for (let k = 0; k < budget; k++) {
    const p = P0 * Math.exp(-k / tau);
    if (p < P_STOP) break;
    const T = temperature(mu, p);
    const i = Math.floor(random() * (current.length - 2));
    const span = current.length - i - 2;
    if (span <= 0) continue;
    const j = i + 2 + Math.floor(random() * span);
    const candidate = reverseSegment(current, i, j);
    const plan = simulate(engineer, candidate, true, speedKmh, travel);
    if (!plan) continue;
    const delta = planScore(plan, engineer) - planScore(currentPlan, engineer);
    if (delta <= 0 || random() < Math.exp(-delta / T)) {
      current = candidate;
      currentPlan = plan;
      if (planScore(plan, engineer) + 1e-9 < planScore(bestPlan, engineer)) {
        best = candidate;
        bestPlan = plan;
        if (ctx) ctx.assignments.set(engineer.id, best);
        if (activeTrace && ctx) emitTrace("anneal", `2-opt ${engineer.name}: ${startedKm.toFixed(1)} → ${bestPlan.distanceKm.toFixed(1)}`, ctx.engineers, ctx.assignments, speedKmh, travel);
      }
    }
  }
  let improved = true;
  let guard = 0;
  while (improved && guard < 12) {
    improved = false;
    guard += 1;
    for (let i = 0; i < best.length - 2; i++) {
      for (let j = i + 2; j < best.length; j++) {
        const candidate = reverseSegment(best, i, j);
        const plan = simulate(engineer, candidate, true, speedKmh, travel);
        if (plan && planScore(plan, engineer) + 1e-6 < planScore(bestPlan, engineer)) {
          const before = bestPlan.distanceKm;
          best = candidate;
          bestPlan = plan;
          improved = true;
          if (ctx) ctx.assignments.set(engineer.id, best);
          if (activeTrace && ctx) emitTrace("anneal", `Локальный 2-opt ${engineer.name}: ${before.toFixed(1)} → ${bestPlan.distanceKm.toFixed(1)}`, ctx.engineers, ctx.assignments, speedKmh, travel);
        }
      }
    }
  }
  if (ctx) ctx.assignments.set(engineer.id, best);
  return best;
}

function pickInsertion(candidates: Array<{ engineer: Engineer; route: Job[]; plan: RoutePlan; score: number }>, random: () => number, p: number) {
  const ranked = [...candidates].sort((a, b) => a.score - b.score);
  const best = ranked[0];
  if (ranked.length === 1 || p < 0.02) return best;
  const mu = ranked.slice(1, 8).reduce((sum, item) => sum + Math.max(0, item.score - best.score), 0) / Math.max(1, Math.min(7, ranked.length - 1)) || 1;
  const T = temperature(mu, p);
  const alt = ranked[1 + Math.floor(random() * (ranked.length - 1))];
  if (random() < Math.exp(-(alt.score - best.score) / T)) return alt;
  return best;
}

function copyAssignments(source: Map<string, Job[]>) {
  return new Map(Array.from(source, ([id, jobs]) => [id, jobs.slice()]));
}

function applyAssignments(target: Map<string, Job[]>, source: Map<string, Job[]>) {
  for (const id of target.keys()) target.set(id, (source.get(id) ?? []).slice());
}

function zoneObjective(engineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined) {
  let score = 0;
  for (const engineer of engineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (!route.length) continue;
    const plan = simulate(engineer, route, true, speedKmh, travel);
    if (!plan) return Number.POSITIVE_INFINITY;
    score += planScore(plan, engineer) + vehiclePenalty();
  }
  return score;
}

function relocateOnce(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number, T: number) {
  const donors = zoneEngineers.filter(item => (assignments.get(item.id)?.length ?? 0) > 0);
  if (!donors.length) return false;
  const from = donors[Math.floor(random() * donors.length)];
  const fromRoute = assignments.get(from.id)!;
  const jobIndex = Math.floor(random() * fromRoute.length);
  const job = fromRoute[jobIndex];
  const without = fromRoute.filter((_, index) => index !== jobIndex);
  const fromPlan = simulate(from, fromRoute, true, speedKmh, travel);
  const withoutPlan = simulate(from, without, true, speedKmh, travel);
  if (!fromPlan || !withoutPlan) return false;
  const targets = zoneEngineers.filter(item => item.id !== from.id && compatible(item, job));
  if (!targets.length) return false;
  const to = targets[Math.floor(random() * targets.length)];
  const toRoute = assignments.get(to.id)!;
  const toPlan = simulate(to, toRoute, true, speedKmh, travel)!;
  let best: { route: Job[]; plan: RoutePlan; score: number } | null = null;
  for (let position = 0; position <= toRoute.length; position++) {
    const candidate = [...toRoute.slice(0, position), job, ...toRoute.slice(position)];
    const plan = simulate(to, candidate, true, speedKmh, travel);
    if (!plan) continue;
    const score = planScore(plan, to);
    if (!best || score < best.score) best = { route: candidate, plan, score };
  }
  if (!best) return false;
  const before = fleetScore(from, fromPlan, to, toPlan, fromRoute.length, toRoute.length);
  const after = fleetScore(from, withoutPlan, to, best.plan, without.length, best.route.length);
  const delta = after - before;
  if (delta <= 0 || random() < Math.exp(-delta / Math.max(T, 1e-6))) {
    assignments.set(from.id, without);
    assignments.set(to.id, best.route);
    emitTrace("relocate", `Перенос ${job.id}: ${from.name} → ${to.name}`, zoneEngineers, assignments, speedKmh, travel, delta <= 1e-9);
    return true;
  }
  return false;
}

function expectedPositiveRelocate(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number) {
  const positives: number[] = [];
  for (let n = 0; n < 24; n++) {
    const donors = zoneEngineers.filter(item => (assignments.get(item.id)?.length ?? 0) > 0);
    if (!donors.length) break;
    const from = donors[Math.floor(random() * donors.length)];
    const fromRoute = assignments.get(from.id)!;
    const jobIndex = Math.floor(random() * fromRoute.length);
    const job = fromRoute[jobIndex];
    const without = fromRoute.filter((_, index) => index !== jobIndex);
    const fromPlan = simulate(from, fromRoute, true, speedKmh, travel);
    const withoutPlan = simulate(from, without, true, speedKmh, travel);
    if (!fromPlan || !withoutPlan) continue;
    const targets = zoneEngineers.filter(item => item.id !== from.id && compatible(item, job));
    if (!targets.length) continue;
    const to = targets[Math.floor(random() * targets.length)];
    const toRoute = assignments.get(to.id)!;
    const toPlan = simulate(to, toRoute, true, speedKmh, travel);
    if (!toPlan) continue;
    let bestPlan: RoutePlan | null = null;
    for (let position = 0; position <= toRoute.length; position++) {
      const plan = simulate(to, [...toRoute.slice(0, position), job, ...toRoute.slice(position)], true, speedKmh, travel);
      if (plan && (!bestPlan || planScore(plan, to) < planScore(bestPlan, to))) bestPlan = plan;
    }
    if (!bestPlan) continue;
    const delta = fleetScore(from, withoutPlan, to, bestPlan, without.length, toRoute.length + 1) - fleetScore(from, fromPlan, to, toPlan, fromRoute.length, toRoute.length);
    if (delta > 1e-6) positives.push(delta);
  }
  return positives.length ? positives.reduce((sum, item) => sum + item, 0) / positives.length : 1;
}

function bestInsert(engineer: Engineer, route: Job[], job: Job, speedKmh: number, travel: TravelMatrix | undefined) {
  let best: { route: Job[]; plan: RoutePlan; score: number } | null = null;
  for (let position = 0; position <= route.length; position++) {
    const candidate = [...route.slice(0, position), job, ...route.slice(position)];
    const plan = simulate(engineer, candidate, true, speedKmh, travel);
    if (!plan) continue;
    const score = planScore(plan, engineer);
    if (!best || score < best.score) best = { route: candidate, plan, score };
  }
  return best;
}

function compactZone(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number) {
  let moved = true;
  while (moved) {
    moved = false;
    const busy = zoneEngineers
      .filter(item => (assignments.get(item.id)?.length ?? 0) > 0)
      .sort((a, b) => (assignments.get(a.id)?.length ?? 0) - (assignments.get(b.id)?.length ?? 0));
    for (const from of busy) {
      const fromRoute = assignments.get(from.id) ?? [];
      if (!fromRoute.length) continue;
      const fromPlan = simulate(from, fromRoute, true, speedKmh, travel);
      if (!fromPlan) continue;
      for (const to of busy) {
        if (to.id === from.id) continue;
        if (!fromRoute.every(job => compatible(to, job))) continue;
        const toRoute = assignments.get(to.id) ?? [];
        const toPlan = simulate(to, toRoute, true, speedKmh, travel);
        if (!toPlan) continue;
        let candidate = [...toRoute];
        let ok = true;
        for (const job of fromRoute) {
          const placed = bestInsert(to, candidate, job, speedKmh, travel);
          if (!placed) { ok = false; break; }
          candidate = placed.route;
        }
        if (!ok) continue;
        const mergedPlan = simulate(to, candidate, true, speedKmh, travel);
        if (!mergedPlan) continue;
        const before = fleetScore(from, fromPlan, to, toPlan, fromRoute.length, toRoute.length);
        const after = fleetScore(from, simulate(from, [], true, speedKmh, travel)!, to, mergedPlan, 0, candidate.length);
        if (after > before + 1e-6) continue;
        assignments.set(to.id, candidate.length >= 3 ? annealRoute(to, candidate, speedKmh, travel, random, 80, { engineers: zoneEngineers, assignments }) : candidate);
        assignments.set(from.id, []);
        emitTrace("compact", `Слияние ${from.name} → ${to.name}`, zoneEngineers, assignments, speedKmh, travel);
        moved = true;
        break;
      }
      if (moved) break;
    }
  }
}

function annealZone(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number, budget: number) {
  let elite = copyAssignments(assignments);
  let eliteScore = zoneObjective(zoneEngineers, assignments, speedKmh, travel);
  const keepElite = (label: string) => {
    const score = zoneObjective(zoneEngineers, assignments, speedKmh, travel);
    if (score + 1e-9 < eliteScore) {
      eliteScore = score;
      elite = copyAssignments(assignments);
      emitTrace("relocate", label, zoneEngineers, assignments, speedKmh, travel);
    }
  };
  const restoreElite = () => {
    const current = zoneObjective(zoneEngineers, assignments, speedKmh, travel);
    if (current <= eliteScore + 1e-9) return;
    applyAssignments(assignments, elite);
    emitTrace("relocate", "Возврат к лучшему найденному плану", zoneEngineers, assignments, speedKmh, travel);
  };
  for (const engineer of zoneEngineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (route.length >= 3) assignments.set(engineer.id, annealRoute(engineer, route, speedKmh, travel, random, Math.min(budget, 400), { engineers: zoneEngineers, assignments }));
  }
  keepElite("Лучший план после 2-opt");
  const tau = Math.max(12, budget / 5);
  const mu = expectedPositiveRelocate(zoneEngineers, assignments, speedKmh, travel, random);
  for (let k = 0; k < budget; k++) {
    const p = P0 * Math.exp(-k / tau);
    if (p < P_STOP) break;
    if (relocateOnce(zoneEngineers, assignments, speedKmh, travel, random, temperature(mu, p))) keepElite("Новый лучший план");
  }
  restoreElite();
  for (const engineer of zoneEngineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (route.length >= 3) assignments.set(engineer.id, annealRoute(engineer, route, speedKmh, travel, random, 80, { engineers: zoneEngineers, assignments }));
  }
  keepElite("Лучший план после полировки");
  compactZone(zoneEngineers, assignments, speedKmh, travel, random);
  keepElite("Лучший план после уплотнения");
  restoreElite();
}

function finish(engineers: Engineer[], inputJobs: Job[], jobs: Job[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, started: number): OptimizationResult {
  const plans = new Map(engineers.map(engineer => [engineer.id, simulate(engineer, assignments.get(engineer.id) ?? [], true, speedKmh, travel)!]));
  const routes = engineers.map(engineer => plans.get(engineer.id)!).filter(route => route.stops.length);
  const assignmentById = new Map(jobs.map(job => [job.id, job.engineerId]));
  const resultJobs = inputJobs.map(job => ({ ...job, engineerId: assignmentById.get(job.id) ?? null, risk: !(assignmentById.get(job.id)) }));
  const baseline = baselinePlan(engineers, inputJobs, speedKmh, travel);
  const metrics = metricsFrom(engineers, resultJobs, routes);
  const zones = regions.map(name => {
    const zoneJobs = resultJobs.filter(job => job.region === name);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const zoneRoutes = routes.filter(route => ids.has(route.engineerId));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    const assigned = zoneRoutes.reduce((sum, route) => sum + route.stops.length, 0);
    const onTime = zoneRoutes.reduce((sum, route) => sum + route.stops.filter(stop => stop.onTime).length, 0);
    return { name, jobs: zoneJobs.length, assigned, sla: assigned ? Math.round(onTime / assigned * 100) : 0, distance: zoneRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: [...ids].length };
  });
  return { jobs: resultJobs, routes, baselineRoutes: baseline.routes, metrics, baseline: baseline.metrics, zones, runtimeMs: Math.round((performance.now() - started) * 10) / 10 };
}

export function optimizeVrptw(engineers: Engineer[], inputJobs: Job[], options: OptimizeOptions = {}): OptimizationResult {
  const speedKmh = options.speedKmh ?? SPEED_KMH;
  const travel = options.travel;
  const started = performance.now();
  const previousObjective = activeObjective;
  const previousTrace = activeTrace;
  activeObjective = options.objective ?? "fieldflow";
  activeTrace = options.trace ?? null;
  const jobs: Job[] = inputJobs.map(job => ({ ...job, engineerId: null, risk: false }));
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const ordered = [...jobs].sort((a, b) => b.priority - a.priority || a.windowEnd - b.windowEnd || a.windowStart - b.windowStart);
  const random = rng.bind(null, { value: options.seed ?? hashSeed(inputJobs, engineers) });
  const innerBudget = options.innerBudget ?? 120;
  const zoneBudget = options.zoneBudget ?? 900;
  emitTrace("insert", "Старт: пустые маршруты", engineers, assignments, speedKmh, travel);

  try {
  for (let index = 0; index < ordered.length; index++) {
    const job = ordered[index];
    const candidates: Array<{ engineer: Engineer; route: Job[]; plan: RoutePlan; score: number }> = [];
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = assignments.get(engineer.id)!;
      const currentPlan = current.length ? simulate(engineer, current, true, speedKmh, travel) : null;
      const currentScore = currentPlan ? planScore(currentPlan, engineer) : 0;
      for (let position = 0; position <= current.length; position++) {
        const candidate = [...current.slice(0, position), job, ...current.slice(position)];
        const plan = simulate(engineer, candidate, true, speedKmh, travel);
        if (!plan) continue;
        candidates.push({ engineer, route: candidate, plan, score: insertionScore(engineer, current.length, currentScore, plan) });
      }
    }
    if (!candidates.length) continue;
    const p = P0 * Math.exp(-index / Math.max(8, ordered.length / 3));
    const chosen = pickInsertion(candidates, random, p);
    if (!chosen) continue;
    const polished = options.skipInsertPolish
      ? chosen.route
      : annealRoute(chosen.engineer, chosen.route, speedKmh, travel, random, innerBudget, { engineers, assignments });
    assignments.set(chosen.engineer.id, polished);
    job.engineerId = chosen.engineer.id;
    emitTrace("insert", `Вставка ${job.id} → ${chosen.engineer.name}`, engineers, assignments, speedKmh, travel);
  }

  for (const name of regions) {
    const zoneEngineers = engineers.filter(item => item.region === name);
    annealZone(zoneEngineers, assignments, speedKmh, travel, random, zoneBudget);
    for (const engineer of zoneEngineers) {
      const ids = new Set((assignments.get(engineer.id) ?? []).map(job => job.id));
      for (const job of jobs) if (ids.has(job.id)) job.engineerId = engineer.id;
    }
  }

  emitTrace("done", "Финальный план", engineers, assignments, speedKmh, travel);
  return finish(engineers, inputJobs, jobs, assignments, speedKmh, travel, started);
  } finally {
    activeObjective = previousObjective;
    activeTrace = previousTrace;
  }
}

export function reoptimizeUrgent(engineers: Engineer[], inputJobs: Job[], urgentId: string, options: OptimizeOptions = {}): OptimizationResult {
  const speedKmh = options.speedKmh ?? SPEED_KMH;
  const travel = options.travel;
  const started = performance.now();
  const jobs = inputJobs.map(job => ({ ...job }));
  const urgent = jobs.find(job => job.id === urgentId);
  if (!urgent) return optimizeVrptw(engineers, inputJobs, options);
  const assignments = new Map(engineers.map(engineer => [engineer.id, jobs.filter(job => job.engineerId === engineer.id && job.id !== urgentId)]));
  urgent.engineerId = null;
  const random = rng.bind(null, { value: (options.seed ?? hashSeed(inputJobs, engineers)) ^ 0x9e3779b9 });
  const candidates: Array<{ engineer: Engineer; route: Job[]; plan: RoutePlan; score: number }> = [];
  for (const engineer of engineers) {
    if (!compatible(engineer, urgent)) continue;
    const current = assignments.get(engineer.id)!;
    const currentPlan = current.length ? simulate(engineer, current, true, speedKmh, travel) : null;
    const currentScore = currentPlan ? planScore(currentPlan, engineer) : 0;
    for (let position = 0; position <= current.length; position++) {
      const candidate = [...current.slice(0, position), urgent, ...current.slice(position)];
      const plan = simulate(engineer, candidate, true, speedKmh, travel);
      if (!plan) continue;
      candidates.push({ engineer, route: candidate, plan, score: insertionScore(engineer, current.length, currentScore, plan) });
    }
  }
  if (!candidates.length) {
    const rest = jobs.filter(job => job.id !== urgentId);
    return optimizeVrptw(engineers, [...rest, urgent], { ...options, innerBudget: 80, zoneBudget: 400 });
  }
  const chosen = pickInsertion(candidates, random, 0.35);
  if (!chosen) return optimizeVrptw(engineers, inputJobs, options);
  assignments.set(chosen.engineer.id, annealRoute(chosen.engineer, chosen.route, speedKmh, travel, random, options.innerBudget ?? 180, { engineers, assignments }));
  urgent.engineerId = chosen.engineer.id;
  const others = engineers
    .filter(item => item.region === chosen.engineer.region && item.id !== chosen.engineer.id)
    .map(item => ({ item, load: simulate(item, assignments.get(item.id) ?? [], true, speedKmh, travel)?.load ?? 0 }))
    .sort((a, b) => a.load - b.load)
    .slice(0, 3)
    .map(entry => entry.item);
  const neighbors = [chosen.engineer, ...others];
  annealZone(neighbors, assignments, speedKmh, travel, random, options.zoneBudget ?? 280);
  for (const engineer of engineers) {
    const ids = new Set((assignments.get(engineer.id) ?? []).map(job => job.id));
    for (const job of jobs) if (ids.has(job.id)) job.engineerId = engineer.id;
  }
  return finish(engineers, inputJobs, jobs, assignments, speedKmh, travel, started);
}

export function minutesLabel(value: number) {
  const normalized = Math.max(0, Math.round(value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function uniquePoints(engineers: Engineer[], jobs: Job[]) {
  const seen = new Set<string>();
  const points: Coordinate[] = [];
  const add = (point: Coordinate) => {
    const key = coordKey(point);
    if (seen.has(key)) return;
    seen.add(key);
    points.push(point);
  };
  for (const engineer of engineers) add(engineer.start);
  for (const job of jobs) add(job.coordinates);
  return points;
}

export function euclideanTravel(speedKmh = SPEED_KMH): TravelMatrix {
  return {
    distanceKm: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
    durationMin: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) / Math.max(0.25, speedKmh / 60),
    knows: () => true,
  };
}

export function makeDemoProblem(pointCount: number, vehicleCount: number, seed = 1) {
  const random = rng.bind(null, { value: seed >>> 0 || 1 });
  const depot: Coordinate = [50, 50];
  const vehicles = Math.max(1, Math.round(vehicleCount));
  const engineers: Engineer[] = Array.from({ length: vehicles }, (_, index) => ({
    id: `demo-${index + 1}`,
    initials: `К${index + 1}`,
    name: vehicles === 1 ? "Курьер" : `Курьер ${index + 1}`,
    route: `Демо ${index + 1}`,
    jobs: 0,
    distance: "0",
    load: 0,
    color: SCALE_COLORS[index % SCALE_COLORS.length],
    region: "Восток",
    start: [...depot] as Coordinate,
    skills: ["Демо"],
    equipment: ["Демо"],
    transport: "Автомобиль",
    shiftStart: 480,
    shiftEnd: 1320,
  }));
  const jobs: Job[] = Array.from({ length: Math.max(3, Math.round(pointCount)) }, (_, index) => {
    let coordinates: Coordinate = [20, 20];
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate: Coordinate = [
        Number((8 + random() * 84).toFixed(2)),
        Number((8 + random() * 84).toFixed(2)),
      ];
      if (Math.hypot(candidate[0] - 50, candidate[1] - 50) > 10) {
        coordinates = candidate;
        break;
      }
    }
    return {
      id: `P${index + 1}`,
      time: "08:00–22:00",
      windowStart: 480,
      windowEnd: 1320,
      area: "Плоскость",
      address: `Точка ${index + 1}`,
      kind: "Демо",
      tone: "violet",
      region: "Восток",
      engineerId: null,
      baselineEngineerId: engineers[index % engineers.length].id,
      coordinates,
      risk: false,
      equipment: "Демо",
      requiredTransport: "Автомобиль",
      priority: 1,
      serviceMinutes: 1,
      source: "Демо",
      status: "Новая",
    };
  });
  return { engineers, jobs, travel: euclideanTravel(60) };
}
