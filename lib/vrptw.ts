import type { Coordinate } from "./map-providers";
import { engineerSpeedKmh, transportTravelMinutes } from "./transport-speed.ts";

export type Region = "Восток" | "Юго-восток" | "Югоцентр";
export type Job = {
  id: string; sourceId?: string; time: string; windowStart: number; windowEnd: number; area: string; address: string;
  kind: string; tone: string; region: Region; engineerId: string | null; baselineEngineerId: string | null;
  coordinates: Coordinate; risk: boolean; equipment: string; requiredTransport: string; allowedTransports?: string[]; priority: number;
  serviceMinutes: number; source: string; status: string; workType?: string; cancelled?: boolean;
  normativeMinutes?: number; travelReserveMinutes?: number; estimatedTravelMinutes?: number;
  normSource?: "экспертный норматив" | "демонстрационное допущение" | "введено пользователем";
  urgency?: "normal" | "urgent"; workClass?: "emergency" | "connection" | "repair";
  executionStatus?: "not_started" | "in_progress" | "completed";
  baselineUnassignedReason?: string; geocodeVerified?: boolean; geocodeQuality?: "house" | "street" | "fallback"; geocodeDisplayName?: string;
  unassignedReason?: string;
  unassignedCategory?: "no_executor" | "cannot_insert" | "alternative_plan" | "not_applicable";
};
export type Engineer = {
  id: string; initials: string; name: string; route: string; jobs: number; distance: string; load: number;
  color: string; region: Region; start: Coordinate; skills: string[]; equipment: string[]; transport: string;
  shiftStart: number; shiftEnd: number; speedKmh?: number;
};
export type RouteStop = { jobId: string; arrival: number; start: number; end: number; distanceKm: number; travelMinutes?: number; onTime: boolean };
export type RoutePlan = { engineerId: string; stops: RouteStop[]; distanceKm: number; durationMinutes: number; load: number };
export type PlanMetrics = { assigned: number; total: number; unassigned: number; activeEngineers: number; distanceKm: number; slaPercent: number; late: number; utilization: number };
export type ZoneMetric = { name: Region; jobs: number; assigned: number; baselineAssigned: number; sla: number; distance: number; baselineDistance: number; engineers: number; baselineEngineers: number };
export type PlanComparison = {
  sameAssignedJobs: boolean;
  commonAssigned: number;
  baselineOnly: number;
  optimizedOnly: number;
  baselineComparableDistanceKm: number | null;
  optimizedComparableDistanceKm: number | null;
  distanceDeltaPercent: number | null;
  reason: string | null;
};
export type OptimizationResult = { jobs: Job[]; routes: RoutePlan[]; baselineRoutes: RoutePlan[]; metrics: PlanMetrics; baseline: PlanMetrics; comparison: PlanComparison; zones: ZoneMetric[]; runtimeMs: number };
export type ReplanChangeKind = "assignment" | "order" | "route" | "fleet" | "time" | "event";
export type ReplanChange = { kind: ReplanChangeKind; key: string; message: string };
export type AssignmentAlternative = { engineerId: string; engineerName: string; reason: string; feasible: boolean };
export type AssignmentExplanation = {
  summary: string;
  checks: string[];
  alternatives: AssignmentAlternative[];
  distanceImpactKm: number;
};
export type TravelMatrix = {
  distanceKm: (a: Coordinate, b: Coordinate) => number;
  durationMin: (a: Coordinate, b: Coordinate) => number;
  knows?: (a: Coordinate, b: Coordinate) => boolean;
  forTransport?: (transport: string) => TravelMatrix;
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

export const VEHICLE_COST = 350;
export const DISTANCE_WEIGHT = 25;
/** Запас сожаления, когда заявку может взять только один инженер, км. */
const INSERT_SOLO_GAP_KM = 24;
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
  const urbanSpeed = Math.max(5, speedKmh);
  return {
    distanceKm: (a, b) => distanceKm(a, b) * 1.5,
    durationMin: (a, b) => {
      const km = distanceKm(a, b) * 1.5;
      return km < 0.001 ? 0 : Math.max(4, km / urbanSpeed * 60 + 3);
    },
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
      min: seconds != null ? Math.max(4, seconds / 60 * 1.25, (meters ?? 0) / 1000 / Math.max(5, speedKmh) * 60 + 3) : fallback.durationMin(a, b),
    };
  };
  return {
    distanceKm: (a, b) => lookup(a, b).km,
    durationMin: (a, b) => lookup(a, b).min,
    knows: (a, b) => {
      const i = index.get(coordKey(a));
      const j = index.get(coordKey(b));
      return i != null && j != null && (i === j || (distances[i]?.[j] != null && durations[i]?.[j] != null));
    },
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

function travelMinutes(a: Coordinate, b: Coordinate, speedKmh: number, travel?: TravelMatrix, engineer?: Engineer) {
  const matrix = (engineer && travel?.forTransport?.(engineer.transport)) ?? travel ?? fallbackTravel(speedKmh);
  if (!engineer) return matrix.durationMin(a, b);
  const actualSpeed = engineerSpeedKmh(engineer.transport, engineer.speedKmh, speedKmh);
  return Math.ceil(transportTravelMinutes(engineer.transport, matrix.distanceKm(a, b), matrix.durationMin(a, b), actualSpeed, speedKmh));
}

function travelDistance(a: Coordinate, b: Coordinate, speedKmh: number, travel?: TravelMatrix, engineer?: Engineer) {
  return ((engineer && travel?.forTransport?.(engineer.transport)) ?? travel ?? fallbackTravel(speedKmh)).distanceKm(a, b);
}

/** Select a smaller team against the actual workload, retaining source order for the baseline. */
export function scaleEngineers(source: Engineer[], count: number, jobs: Job[] = []): Engineer[] {
  const n = Math.max(1, Math.round(count));
  if (!source.length) return [];
  if (n < source.length && jobs.length) {
    const relevant = jobs.filter(job => !job.cancelled);
    const travel = fallbackTravel(SPEED_KMH);
    const regions = [...new Set(source.map(engineer => engineer.region))];
    const demand = new Map(regions.map(region => [region, 0]));
    for (const job of relevant) {
      const local = source.filter(engineer => engineer.region === job.region);
      if (!local.length) continue;
      const nearest = Math.min(...local.map(engineer => travelMinutes(engineer.start, job.coordinates, SPEED_KMH, travel, engineer)));
      demand.set(job.region, (demand.get(job.region) ?? 0) + job.serviceMinutes + Math.min(40, nearest * 0.5));
    }
    const quotas = new Map(regions.map(region => [region, 0]));
    const positive = regions.filter(region => (demand.get(region) ?? 0) > 0);
    if (n >= positive.length) for (const region of positive) quotas.set(region, 1);
    for (let slot = [...quotas.values()].reduce((sum, value) => sum + value, 0); slot < n; slot++) {
      let bestRegion: Region | null = null;
      let bestDeficit = -Infinity;
      const totalDemand = [...demand.values()].reduce((sum, value) => sum + value, 0);
      for (const region of regions) {
        const current = quotas.get(region) ?? 0;
        if (current >= source.filter(engineer => engineer.region === region).length) continue;
        const target = totalDemand ? (demand.get(region) ?? 0) / totalDemand * n : source.filter(engineer => engineer.region === region).length / source.length * n;
        const deficit = target - current;
        if (deficit > bestDeficit) { bestDeficit = deficit; bestRegion = region; }
      }
      if (bestRegion) quotas.set(bestRegion, (quotas.get(bestRegion) ?? 0) + 1);
    }
    const coveredBy = source.map(engineer => relevant.map((job, index) => compatible(engineer, job) ? index : -1).filter(index => index >= 0));
    const coverage = new Uint16Array(relevant.length);
    const chosen = new Set<number>();
    for (let slot = 0; slot < n; slot++) {
      let bestIndex = -1;
      let bestScore = -1;
      for (let index = 0; index < source.length; index++) {
        const region = source[index].region;
        if (chosen.has(index) || [...chosen].filter(selected => source[selected].region === region).length >= (quotas.get(region) ?? 0)) continue;
        // Diminishing returns favour an unrepresented region or resource class,
        // then add capacity where the compatible workload is still largest.
        const score = coveredBy[index].reduce((sum, jobIndex) => sum + relevant[jobIndex].serviceMinutes / (1 + coverage[jobIndex]) ** 2, 0);
        if (score > bestScore) { bestScore = score; bestIndex = index; }
      }
      chosen.add(bestIndex);
      for (const jobIndex of coveredBy[bestIndex]) coverage[jobIndex]++;
    }
    return source.filter((_, index) => chosen.has(index)).map(item => ({ ...item, start: [...item.start] as Coordinate, skills: [...item.skills], equipment: [...item.equipment] }));
  }
  if (n <= source.length) return source.slice(0, n).map(item => ({ ...item, start: [...item.start] as Coordinate, skills: [...item.skills], equipment: [...item.equipment] }));
  const result = source.map(item => ({ ...item, start: [...item.start] as Coordinate, skills: [...item.skills], equipment: [...item.equipment] }));
  for (let i = source.length; i < n; i++) {
    const base = source[spreadIndex(i - source.length, source.length)];
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

function spreadIndex(index: number, length: number) {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  let step = Math.max(2, Math.round(length * 0.36));
  while (gcd(step, length) !== 1) step++;
  return index * step % length;
}

export function scaleJobs(source: Job[], count: number): Job[] {
  const n = Math.max(0, Math.round(count));
  if (!source.length || n === 0) return [];
  if (n < source.length) {
    const selected = new Set(Array.from({ length: n }, (_, index) => spreadIndex(index, source.length)));
    return source.filter((_, index) => selected.has(index)).map(job => ({ ...job, coordinates: [...job.coordinates] as Coordinate }));
  }
  if (n === source.length) return source.map(job => ({ ...job, coordinates: [...job.coordinates] as Coordinate }));
  const result = source.map(job => ({ ...job, coordinates: [...job.coordinates] as Coordinate }));
  for (let i = source.length; i < n; i++) {
    const base = source[spreadIndex(i - source.length, source.length)];
    result.push({
      ...base,
      id: String(i + 1).padStart(4, "0"),
      // A repeated visit at the same address must retain its verified location.
      coordinates: [...base.coordinates] as Coordinate,
      engineerId: null,
      baselineEngineerId: null,
      source: "Синтетика",
      status: "Новая",
    });
  }
  return result;
}

/** Vary SLA windows around a requested mean; paired widths keep that mean exact. */
export function applyAverageWindows(jobs: Job[], averageMinutes: number): Job[] {
  const dayStart = 480;
  const dayEnd = 1320;
  const daySpan = dayEnd - dayStart;
  const mean = Math.min(daySpan, Math.max(60, Math.round(averageMinutes / 15) * 15));
  const bandCount = Math.max(1, Math.round(daySpan / mean));
  const pitch = bandCount === 1 ? 0 : (daySpan - mean) / (bandCount - 1);
  const amplitude = Math.max(0, Math.min(60, mean - 30, daySpan - mean));
  return jobs.map((job, index) => {
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
    const pairAmplitude = Math.min(amplitude, 30 + Math.floor(index / 2) % 3 * 15);
    const offset = jobs.length % 2 && index === jobs.length - 1 ? 0 : index % 2 ? pairAmplitude : -pairAmplitude;
    const width = mean + offset;
    const bandCenter = dayStart + band * pitch + mean / 2;
    let start = Math.round((bandCenter - width / 2) / 15) * 15;
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

export function transportAllowed(job: Pick<Job, "requiredTransport" | "allowedTransports">, transport: string) {
  if (job.requiredTransport) return engineerTransport(transport) === engineerTransport(job.requiredTransport);
  if (job.allowedTransports?.length) return job.allowedTransports.some(mode => engineerTransport(transport) === engineerTransport(mode));
  return true;
}

function engineerTransport(value: string) { return value === "Пешеход" ? "Пешком" : value; }

export function compatible(engineer: Engineer, job: Job) {
  return !job.cancelled && job.executionStatus !== "completed" && engineer.region === job.region && transportAllowed(job, engineer.transport) && engineer.equipment.includes(job.equipment) && engineer.skills.includes(job.kind);
}

export function resourceBlocker(engineers: Engineer[], job: Job) {
  const local = engineers.filter(engineer => engineer.region === job.region);
  if (!local.length) return `В регионе ${job.region} нет доступных инженеров.`;
  const skilled = local.filter(engineer => engineer.skills.includes(job.kind));
  if (!skilled.length) return `Нет инженера с навыком «${job.kind}» в регионе ${job.region}.`;
  const equipped = skilled.filter(engineer => engineer.equipment.includes(job.equipment));
  if (!equipped.length) return `У инженеров с нужным навыком нет оборудования «${job.equipment}».`;
  if (!equipped.some(engineer => transportAllowed(job, engineer.transport))) return `Нет инженера с требуемым транспортом «${job.requiredTransport || job.allowedTransports?.join(", ") || "любой"}».`;
  return "Нет допустимого исполнителя по ресурсам; проверьте исходные данные.";
}

export function simulate(engineer: Engineer, route: Job[], hardWindows = true, speedKmh = SPEED_KMH, travel?: TravelMatrix): RoutePlan | null {
  let point = engineer.start;
  let time = engineer.shiftStart;
  let totalDistance = 0;
  const stops: RouteStop[] = [];
  for (const job of route) {
    const leg = travelDistance(point, job.coordinates, speedKmh, travel, engineer);
    const arrival = time + travelMinutes(point, job.coordinates, speedKmh, travel, engineer);
    const start = Math.max(arrival, job.windowStart);
    const end = start + job.serviceMinutes;
    if (hardWindows && (start > job.windowEnd || end > engineer.shiftEnd)) return null;
    totalDistance += leg;
    stops.push({ jobId: job.id, arrival, start, end, distanceKm: leg, travelMinutes: arrival - time, onTime: start <= job.windowEnd });
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
  const total = jobs.filter(job => !job.cancelled && job.executionStatus !== "completed").length;
  const assigned = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = routes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const distance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  const utilization = routes.length ? routes.reduce((sum, route) => sum + route.load, 0) / routes.length : 0;
  return { assigned, total, unassigned: total - assigned, activeEngineers: routes.length, distanceKm: distance, slaPercent: assigned ? Math.round((assigned - late) / assigned * 1000) / 10 : 0, late, utilization: Math.round(utilization) };
}

export function comparePlans(baselineRoutes: RoutePlan[], routes: RoutePlan[]): PlanComparison {
  const baselineIds = baselineRoutes.flatMap(route => route.stops.map(stop => stop.jobId)).sort();
  const optimizedIds = routes.flatMap(route => route.stops.map(stop => stop.jobId)).sort();
  if (baselineIds.length !== optimizedIds.length || baselineIds.some((id, index) => id !== optimizedIds[index])) {
    const baselineSet = new Set(baselineIds);
    const optimizedSet = new Set(optimizedIds);
    const commonAssigned = baselineIds.filter(id => optimizedSet.has(id)).length;
    return { sameAssignedJobs: false, commonAssigned, baselineOnly: baselineIds.filter(id => !optimizedSet.has(id)).length, optimizedOnly: optimizedIds.filter(id => !baselineSet.has(id)).length, baselineComparableDistanceKm: null, optimizedComparableDistanceKm: null, distanceDeltaPercent: null, reason: "Планы выполняют разные заявки: для процента требуется сравнение общего набора." };
  }
  const baselineDistance = baselineRoutes.reduce((sum, route) => sum + route.distanceKm, 0);
  const optimizedDistance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  return { sameAssignedJobs: true, commonAssigned: baselineIds.length, baselineOnly: 0, optimizedOnly: 0, baselineComparableDistanceKm: baselineDistance, optimizedComparableDistanceKm: optimizedDistance, distanceDeltaPercent: baselineDistance > 0 ? (optimizedDistance / baselineDistance - 1) * 100 : null, reason: baselineDistance > 0 ? null : "Нет исходного пробега для сравнения." };
}

/** Compare distance only for job IDs served by both plans, preserving each plan's own visit order. */
export function comparePlansStrict(engineers: Engineer[], jobs: Job[], baselineRoutes: RoutePlan[], routes: RoutePlan[], speedKmh = SPEED_KMH, travel?: TravelMatrix): PlanComparison {
  const baselineIds = new Set(baselineRoutes.flatMap(route => route.stops.map(stop => stop.jobId)));
  const optimizedIds = new Set(routes.flatMap(route => route.stops.map(stop => stop.jobId)));
  const common = new Set([...baselineIds].filter(id => optimizedIds.has(id)));
  const byEngineer = new Map(engineers.map(engineer => [engineer.id, engineer]));
  const byJob = new Map(jobs.map(job => [job.id, job]));
  const projectedDistance = (plans: RoutePlan[]) => plans.reduce((total, plan) => {
    const engineer = byEngineer.get(plan.engineerId);
    if (!engineer) return total;
    let point = engineer.start;
    for (const stop of plan.stops) {
      if (!common.has(stop.jobId)) continue;
      const job = byJob.get(stop.jobId);
      if (!job) continue;
      total += travelDistance(point, job.coordinates, speedKmh, travel, engineer);
      point = job.coordinates;
    }
    return total;
  }, 0);
  const baselineDistance = common.size ? projectedDistance(baselineRoutes) : 0;
  const optimizedDistance = common.size ? projectedDistance(routes) : 0;
  const sameAssignedJobs = baselineIds.size === optimizedIds.size && baselineIds.size === common.size;
  return {
    sameAssignedJobs,
    commonAssigned: common.size,
    baselineOnly: [...baselineIds].filter(id => !optimizedIds.has(id)).length,
    optimizedOnly: [...optimizedIds].filter(id => !baselineIds.has(id)).length,
    baselineComparableDistanceKm: common.size ? baselineDistance : null,
    optimizedComparableDistanceKm: common.size ? optimizedDistance : null,
    distanceDeltaPercent: baselineDistance > 0 ? (optimizedDistance / baselineDistance - 1) * 100 : null,
    reason: !common.size ? "Нет общего набора выполненных заявок для сопоставимого сравнения." : sameAssignedJobs ? null : `Пробег сопоставлен строго на ${common.size} заявках, выполненных обоими планами. Покрытие показано отдельно.`,
  };
}

/**
 * Official case baseline: preserve job input order, scan engineers in their
 * input order, and append to the first feasible route. No insertion, route
 * reordering, local search or global repair is allowed here.
 */
export function baselinePlan(engineers: Engineer[], jobs: Job[], speedKmh = SPEED_KMH, travel?: TravelMatrix) {
  const assigned = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const plans = new Map<string, RoutePlan>();
  const assignmentById = new Map<string, string>();
  const unassignedReasons = new Map<string, string>();
  for (const job of jobs) {
    if (job.cancelled || job.executionStatus === "completed") continue;
    const compatibleEngineers = engineers.filter(engineer => compatible(engineer, job));
    if (!compatibleEngineers.length) {
      unassignedReasons.set(job.id, resourceBlocker(engineers, job));
      continue;
    }
    let selected: { engineer: Engineer; route: Job[]; plan: RoutePlan } | null = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = assigned.get(engineer.id)!;
      const route = [...current, job];
      const plan = simulate(engineer, route, true, speedKmh, travel);
      if (!plan) continue;
      selected = { engineer, route, plan };
      break;
    }
    if (selected) {
      assigned.set(selected.engineer.id, selected.route);
      plans.set(selected.engineer.id, selected.plan);
      assignmentById.set(job.id, selected.engineer.id);
    } else unassignedReasons.set(job.id, "Последовательный baseline не нашёл инженера, которому заявку можно добавить в конец маршрута без нарушения окна или смены.");
  }
  const routes = engineers.map(engineer => plans.get(engineer.id)).filter((route): route is RoutePlan => Boolean(route));
  return { routes, metrics: metricsFrom(engineers, jobs, routes), assignmentById, unassignedReasons };
}

function routePositions(result: OptimizationResult) {
  const map = new Map<string, { engineerId: string; position: number }>();
  for (const route of result.routes) route.stops.forEach((stop, index) => map.set(stop.jobId, { engineerId: route.engineerId, position: index + 1 }));
  return map;
}

/** Human-readable, deterministic difference between two calculated plans. */
export function compareReplannedPlans(before: OptimizationResult, after: OptimizationResult, engineers: Engineer[], eventTime?: number): ReplanChange[] {
  const names = new Map(engineers.map(engineer => [engineer.id, engineer.name]));
  const previous = routePositions(before);
  const next = routePositions(after);
  const changes: ReplanChange[] = [];
  const jobIds = new Set([...before.jobs.map(job => job.id), ...after.jobs.map(job => job.id)]);
  const oldStops = new Map(before.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const)));
  const newStops = new Map(after.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const)));
  for (const jobId of jobIds) {
    if (eventTime != null && (oldStops.get(jobId)?.start ?? Infinity) < eventTime) continue;
    const oldPlace = previous.get(jobId);
    const newPlace = next.get(jobId);
    if (oldPlace?.engineerId !== newPlace?.engineerId) {
      const oldName = oldPlace ? names.get(oldPlace.engineerId) ?? oldPlace.engineerId : null;
      const newName = newPlace ? names.get(newPlace.engineerId) ?? newPlace.engineerId : null;
      const message = oldName && newName
        ? `№${jobId} переназначена: ${oldName} → ${newName}.`
        : newName ? `№${jobId} назначена инженеру ${newName}.` : `№${jobId} снята с маршрута ${oldName ?? "инженера"}.`;
      changes.push({ kind: "assignment", key: `assignment-${jobId}`, message });
    } else if (oldPlace && newPlace && oldPlace.position !== newPlace.position) {
      changes.push({ kind: "order", key: `order-${jobId}`, message: `№${jobId} перемещена с ${oldPlace.position}-го на ${newPlace.position}-е место в маршруте ${names.get(newPlace.engineerId) ?? newPlace.engineerId}.` });
    }
    const oldTime = oldStops.get(jobId)?.start;
    const newTime = newStops.get(jobId)?.start;
    if (oldTime != null && newTime != null && oldTime !== newTime) changes.push({ kind: "time", key: `time-${jobId}`, message: `У клиента №${jobId} изменилось согласованное начало: ${minutesLabel(oldTime)} → ${minutesLabel(newTime)}.` });
  }

  const oldRoutes = new Map(before.routes.map(route => [route.engineerId, route]));
  const newRoutes = new Map(after.routes.map(route => [route.engineerId, route]));
  const engineerIds = new Set([...oldRoutes.keys(), ...newRoutes.keys()]);
  for (const engineerId of engineerIds) {
    const oldRoute = oldRoutes.get(engineerId);
    const newRoute = newRoutes.get(engineerId);
    const name = names.get(engineerId) ?? engineerId;
    if (!oldRoute && newRoute) {
      changes.push({ kind: "fleet", key: `fleet-on-${engineerId}`, message: `Задействован новый инженер ${name}: ${newRoute.stops.length} заявок, ${newRoute.distanceKm.toFixed(1)} км.` });
      continue;
    }
    if (oldRoute && !newRoute) {
      changes.push({ kind: "fleet", key: `fleet-off-${engineerId}`, message: `${name} выведен из маршрутов; ранее было ${oldRoute.stops.length} заявок.` });
      continue;
    }
    if (!oldRoute || !newRoute) continue;
    const delta = newRoute.distanceKm - oldRoute.distanceKm;
    const oldOrder = oldRoute.stops.map(stop => stop.jobId).join("|");
    const newOrder = newRoute.stops.map(stop => stop.jobId).join("|");
    if (Math.abs(delta) >= 0.05 || oldOrder !== newOrder) {
      const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
      changes.push({ kind: "route", key: `route-${engineerId}`, message: `Маршрут ${name} изменён: ${oldRoute.distanceKm.toFixed(1)} → ${newRoute.distanceKm.toFixed(1)} км (${sign}${Math.abs(delta).toFixed(1)} км).` });
    }
  }
  return changes;
}

/** Explain a concrete assignment against feasible insertions into other routes. */
export function explainAssignment(job: Job, engineer: Engineer, plan: RoutePlan, engineers: Engineer[], routes: RoutePlan[], jobs: Job[], speedKmh = SPEED_KMH, travel?: TravelMatrix): AssignmentExplanation {
  const byId = new Map(jobs.map(item => [item.id, item]));
  const routeByEngineer = new Map(routes.map(route => [route.engineerId, route]));
  const stop = plan.stops.find(item => item.jobId === job.id);
  const routeJobs = plan.stops.map(item => byId.get(item.jobId)).filter((item): item is Job => Boolean(item));
  const without = routeJobs.filter(item => item.id !== job.id);
  const withoutPlan = without.length ? simulate(engineer, without, true, speedKmh, travel) : null;
  const distanceImpactKm = Math.max(0, plan.distanceKm - (withoutPlan?.distanceKm ?? 0));
  const start = stop?.start ?? job.windowStart;
  const checks = [
    `Навык «${job.kind}» подтверждён у инженера.`,
    `Оборудование «${job.equipment}» и транспорт «${engineer.transport}» доступны.`,
    `Регион ${job.region}; прибытие ${minutesLabel(stop?.arrival ?? start)}, начало ${minutesLabel(start)}, окончание ${minutesLabel(stop?.end ?? start + job.serviceMinutes)} — внутри SLA ${job.time} и смены ${minutesLabel(engineer.shiftStart)}–${minutesLabel(engineer.shiftEnd)}.`,
    plan.stops.length > 1 ? `Заявка встроена в уже используемый маршрут; дополнительный инженер не потребовался.` : `Для выполнения заявки задействован этот инженер.`,
    `Вклад заявки в маршрут — около ${distanceImpactKm.toFixed(1)} км.`,
  ];

  const alternatives = engineers.filter(item => item.id !== engineer.id).map(candidate => {
    const prefix = { engineerId: candidate.id, engineerName: candidate.name || candidate.id, proximityKm: travelDistance(candidate.start, job.coordinates, speedKmh, travel, candidate) };
    if (candidate.region !== job.region) return { ...prefix, feasible: false, reason: `другой регион: ${candidate.region}` };
    if (!candidate.skills.includes(job.kind)) return { ...prefix, feasible: false, reason: `нет навыка «${job.kind}»` };
    if (!candidate.equipment.includes(job.equipment)) return { ...prefix, feasible: false, reason: `нет оборудования «${job.equipment}»` };
    if (!transportAllowed(job, candidate.transport)) return { ...prefix, feasible: false, reason: `транспорт «${candidate.transport}» не подходит` };
    const existingPlan = routeByEngineer.get(candidate.id);
    const existingJobs = existingPlan?.stops.map(item => byId.get(item.jobId)).filter((item): item is Job => Boolean(item)) ?? [];
    const insertion = bestInsert(candidate, existingJobs, job, speedKmh, travel);
    if (!insertion) return { ...prefix, feasible: false, reason: `нет допустимой вставки в окно и смену` };
    const added = Math.max(0, insertion.plan.distanceKm - (existingPlan?.distanceKm ?? 0));
    const activation = existingJobs.length ? "маршрут уже активен" : "потребовалось бы задействовать дополнительного инженера";
    const reason = added + 0.05 >= distanceImpactKm
      ? `${activation}; локальный прирост ${added.toFixed(1)} км против ${distanceImpactKm.toFixed(1)} км у выбранного`
      : `${activation}; локально +${added.toFixed(1)} км, но глобально ухудшается порядок, окна или целевая функция плана`;
    return { ...prefix, feasible: true, reason };
  }).sort((a, b) => a.proximityKm - b.proximityKm || Number(b.feasible) - Number(a.feasible)).slice(0, 3).map(item => ({ engineerId: item.engineerId, engineerName: item.engineerName, reason: item.reason, feasible: item.feasible }));

  return {
    summary: `${engineer.name || engineer.id} выбран: обязательные ресурсы подтверждены, работа начинается в ${minutesLabel(start)}, а назначение ${plan.stops.length > 1 ? "не увеличивает активный штат" : "обеспечивает выполнение заявки"}.`,
    checks,
    alternatives,
    distanceImpactKm,
  };
}

export function idleOptimization(engineers: Engineer[], jobs: Job[], speedKmh = SPEED_KMH, travel?: TravelMatrix): OptimizationResult {
  const baseline = baselinePlan(engineers, jobs, speedKmh, travel);
  const zones = regions.map(name => {
    const zoneJobs = jobs.filter(job => job.region === name);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    return { name, jobs: zoneJobs.length, assigned: 0, baselineAssigned: baseRoutes.reduce((sum, route) => sum + route.stops.length, 0), sla: 0, distance: 0, baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: 0, baselineEngineers: baseRoutes.length };
  });
  return { jobs: jobs.map(job => ({ ...job, engineerId: null, baselineEngineerId: baseline.assignmentById.get(job.id) ?? null, baselineUnassignedReason: baseline.unassignedReasons.get(job.id) })), routes: [], baselineRoutes: baseline.routes, metrics: { assigned: 0, total: jobs.length, unassigned: jobs.length, activeEngineers: 0, distanceKm: 0, slaPercent: 0, late: 0, utilization: 0 }, baseline: baseline.metrics, comparison: comparePlansStrict(engineers, jobs, baseline.routes, [], speedKmh, travel), zones, runtimeMs: 0 };
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

/** Maximize served jobs before minimizing fleet size: try an insertion, then one displacement. */
function recoverUnassigned(engineers: Engineer[], jobs: Job[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined) {
  const assigned = new Set([...assignments.values()].flatMap(route => route.map(job => job.id)));
  const pending = jobs.filter(job => !assigned.has(job.id)).sort((a, b) => {
    const aChoices = engineers.filter(engineer => compatible(engineer, a)).length;
    const bChoices = engineers.filter(engineer => compatible(engineer, b)).length;
    return aChoices - bChoices || a.windowEnd - b.windowEnd || b.priority - a.priority;
  });
  for (const job of pending) {
    let direct: { engineer: Engineer; route: Job[]; score: number } | null = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = assignments.get(engineer.id) ?? [];
      const placed = bestInsert(engineer, current, job, speedKmh, travel);
      if (!placed) continue;
      const currentPlan = simulate(engineer, current, true, speedKmh, travel);
      const score = insertionScore(engineer, current.length, currentPlan ? planScore(currentPlan, engineer) : 0, placed.plan);
      if (!direct || score < direct.score) direct = { engineer, route: placed.route, score };
    }
    if (direct) {
      assignments.set(direct.engineer.id, direct.route);
      continue;
    }
    let repaired: { from: Engineer; to: Engineer; fromRoute: Job[]; toRoute: Job[]; score: number } | null = null;
    for (const from of engineers) {
      if (!compatible(from, job)) continue;
      const current = assignments.get(from.id) ?? [];
      for (let index = 0; index < current.length; index++) {
        const displaced = current[index];
        const without = current.filter((_, i) => i !== index);
        const withNew = bestInsert(from, without, job, speedKmh, travel);
        if (!withNew) continue;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const destination = to.id === from.id ? withNew.route : assignments.get(to.id) ?? [];
          const reinserted = bestInsert(to, destination, displaced, speedKmh, travel);
          if (!reinserted) continue;
          const score = planScore(to.id === from.id ? reinserted.plan : withNew.plan, from)
            + (to.id === from.id ? 0 : planScore(reinserted.plan, to))
            + (to.id !== from.id && !destination.length ? VEHICLE_COST : 0);
          if (!repaired || score < repaired.score) repaired = {
            from, to,
            fromRoute: to.id === from.id ? reinserted.route : withNew.route,
            toRoute: reinserted.route,
            score,
          };
        }
      }
    }
    if (repaired) {
      assignments.set(repaired.from.id, repaired.fromRoute);
      if (repaired.to.id !== repaired.from.id) assignments.set(repaired.to.id, repaired.toRoute);
      continue;
    }
    // A lightly loaded qualified engineer can still be trapped by the order
    // of their current stops. Rehome those stops before declaring the job lost.
    const evacuationTargets = engineers.filter(engineer => compatible(engineer, job))
      .sort((a, b) => (assignments.get(a.id)?.length ?? 0) - (assignments.get(b.id)?.length ?? 0));
    for (const from of evacuationTargets) {
      const current = assignments.get(from.id) ?? [];
      if (!current.length || current.length > 8 || !simulate(from, [job], true, speedKmh, travel)) continue;
      const draft = new Map([...assignments].map(([id, route]) => [id, [...route]]));
      draft.set(from.id, [job]);
      const displacedJobs = [...current].sort((a, b) =>
        engineers.filter(engineer => compatible(engineer, a)).length - engineers.filter(engineer => compatible(engineer, b)).length
        || a.windowEnd - b.windowEnd);
      let feasible = true;
      for (const displaced of displacedJobs) {
        let placement: { engineer: Engineer; route: Job[]; score: number } | null = null;
        for (const to of engineers) {
          if (!compatible(to, displaced)) continue;
          const route = draft.get(to.id) ?? [];
          const inserted = bestInsert(to, route, displaced, speedKmh, travel);
          if (!inserted) continue;
          const score = planScore(inserted.plan, to) + (!route.length ? VEHICLE_COST : 0);
          if (!placement || score < placement.score) placement = { engineer: to, route: inserted.route, score };
        }
        if (!placement) { feasible = false; break; }
        draft.set(placement.engineer.id, placement.route);
      }
      if (!feasible) continue;
      for (const [id, route] of draft) assignments.set(id, route);
      break;
    }
  }
}

function syncAssignments(engineers: Engineer[], jobs: Job[], assignments: Map<string, Job[]>) {
  for (const job of jobs) job.engineerId = null;
  for (const engineer of engineers) for (const job of assignments.get(engineer.id) ?? []) job.engineerId = engineer.id;
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
  const stopByJob = new Map(routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const)));
  const assignmentById = new Map(jobs.map(job => [job.id, job.engineerId]));
  const baseline = baselinePlan(engineers, inputJobs, speedKmh, travel);
  const resultJobs = inputJobs.map(job => {
    const engineerId = assignmentById.get(job.id) ?? null;
    const eligible = engineers.filter(engineer => compatible(engineer, job));
    let unassignedReason: string | undefined;
    let unassignedCategory: Job["unassignedCategory"];
    if (!engineerId) {
      if (job.cancelled) {
        unassignedCategory = "not_applicable";
        unassignedReason = "Заявка отменена диспетчером и исключена из расчёта.";
      } else if (job.executionStatus === "completed") {
        unassignedCategory = "not_applicable";
        unassignedReason = "Работа завершена; повторное назначение не требуется.";
      } else if (!eligible.length) {
        unassignedCategory = "no_executor";
        unassignedReason = resourceBlocker(engineers, job);
      } else if (!eligible.some(engineer => simulate(engineer, [job], true, speedKmh, travel))) {
        unassignedCategory = "no_executor";
        const earliest = Math.min(...eligible.map(engineer => engineer.shiftStart + travelMinutes(engineer.start, job.coordinates, speedKmh, travel, engineer)));
        unassignedReason = earliest > job.windowEnd
          ? `Даже свободный подходящий инженер приедет не раньше ${minutesLabel(earliest)}, а окно заканчивается в ${minutesLabel(job.windowEnd)}.`
          : "Даже свободный подходящий инженер не успевает выполнить заявку до конца своей смены.";
      } else if (baseline.assignmentById.has(job.id)) {
        unassignedCategory = "alternative_plan";
        const baselineId = baseline.assignmentById.get(job.id)!;
        const baselineEngineer = engineers.find(engineer => engineer.id === baselineId);
        unassignedReason = `Допустимое назначение существует: baseline назначает ${baselineEngineer?.name ?? baselineId}. VRPTW выбрал другой набор работ; точную потерю покрытия, приоритета и пробега показывает принудительный расчёт ниже.`;
      } else if (eligible.some(engineer => !(assignments.get(engineer.id)?.length) && simulate(engineer, [job], true, speedKmh, travel))) {
        unassignedCategory = "alternative_plan";
        unassignedReason = "Допустимый исполнитель есть, в том числе свободный. Заявка не вошла в найденный план; это не отсутствие навыка или невозможность SLA. Проверьте принудительный расчёт.";
      } else if (eligible.some(engineer => {
        const assigned = assignments.get(engineer.id) ?? [];
        return Array.from({ length: assigned.length + 1 }, (_, index) => index).some(index => simulate(engineer, [...assigned.slice(0, index), job, ...assigned.slice(index)], true, speedKmh, travel));
      })) {
        unassignedCategory = "alternative_plan";
        unassignedReason = "Заявку можно вставить в один из текущих маршрутов без нарушения жёстких ограничений, но solver её не выбрал. Это возможный пробел поиска; повторите расчёт или проверьте принудительный сценарий.";
      } else if (eligible.length === 1) {
        unassignedCategory = "cannot_insert";
        const only = eligible[0];
        const count = assignments.get(only.id)?.length ?? 0;
        unassignedReason = `Единственный подходящий инженер — ${only.name}; у него уже ${count} заявки. Заявка выполнима отдельно, но её не удалось встроить в найденный маршрут без перестройки других назначений.`;
      } else {
        unassignedCategory = "cannot_insert";
        unassignedReason = `${eligible.length} инженеров подходят по навыку и ресурсам. Заявка выполнима отдельно, но не вошла в текущую комбинацию маршрутов; принудительный расчёт покажет цену её включения.`;
      }
    }
    return { ...job, engineerId, estimatedTravelMinutes: stopByJob.get(job.id)?.travelMinutes ?? job.estimatedTravelMinutes, baselineEngineerId: baseline.assignmentById.get(job.id) ?? null, baselineUnassignedReason: baseline.unassignedReasons.get(job.id), unassignedReason, unassignedCategory, risk: !engineerId && !job.cancelled && job.executionStatus !== "completed" };
  });
  const metrics = metricsFrom(engineers, resultJobs, routes);
  const zones = regions.map(name => {
    const zoneJobs = resultJobs.filter(job => job.region === name && !job.cancelled && job.executionStatus !== "completed");
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const zoneRoutes = routes.filter(route => ids.has(route.engineerId));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    const assigned = zoneRoutes.reduce((sum, route) => sum + route.stops.length, 0);
    const onTime = zoneRoutes.reduce((sum, route) => sum + route.stops.filter(stop => stop.onTime).length, 0);
    return { name, jobs: zoneJobs.length, assigned, baselineAssigned: baseRoutes.reduce((sum, route) => sum + route.stops.length, 0), sla: zoneJobs.length ? Math.round(onTime / zoneJobs.length * 100) : 0, distance: zoneRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: zoneRoutes.length, baselineEngineers: baseRoutes.length };
  });
  return { jobs: resultJobs, routes, baselineRoutes: baseline.routes, metrics, baseline: baseline.metrics, comparison: comparePlansStrict(engineers, inputJobs, baseline.routes, routes, speedKmh, travel), zones, runtimeMs: Math.round((performance.now() - started) * 10) / 10 };
}

/** Validate and evaluate route orders returned by an external solver. */
export function resultFromRouteOrder(engineers: Engineer[], inputJobs: Job[], routeOrders: Array<{ engineerId: string; jobIds: string[] }>, options: OptimizeOptions = {}): OptimizationResult {
  const speedKmh = options.speedKmh ?? SPEED_KMH;
  const travel = options.travel;
  const started = performance.now();
  const jobs = inputJobs.map(job => ({ ...job, engineerId: null, risk: false }));
  const byJob = new Map(jobs.map(job => [job.id, job]));
  const byEngineer = new Map(engineers.map(engineer => [engineer.id, engineer]));
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const seen = new Set<string>();
  for (const order of routeOrders) {
    const engineer = byEngineer.get(order.engineerId);
    if (!engineer) throw new Error(`Solver returned unknown engineer ${order.engineerId}`);
    const route: Job[] = [];
    for (const id of order.jobIds) {
      const job = byJob.get(id);
      if (!job) throw new Error(`Solver returned unknown job ${id}`);
      if (seen.has(id)) throw new Error(`Solver assigned job ${id} more than once`);
      if (!compatible(engineer, job)) throw new Error(`Solver violated resources for job ${id}`);
      seen.add(id);
      route.push(job);
    }
    if (!simulate(engineer, route, true, speedKmh, travel)) throw new Error(`Solver returned infeasible route for ${engineer.id}`);
    assignments.set(engineer.id, route);
  }
  syncAssignments(engineers, jobs, assignments);
  return finish(engineers, inputJobs, jobs, assignments, speedKmh, travel, started);
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
  const random = rng.bind(null, { value: options.seed ?? hashSeed(inputJobs, engineers) });
  const zoneBudget = options.zoneBudget ?? 900;
  emitTrace("insert", "Старт: пустые маршруты", engineers, assignments, speedKmh, travel);

  try {
  // Сожаление: километр × DISTANCE_WEIGHT, новый инженер = VEHICLE_COST.
  // Если кандидат один, запас равен 24 км × DISTANCE_WEIGHT: на четырёх наборах
  // ТЗ это те же 513/520 и 114 инженеров, но на 38 км короче, чем запас в 14 км.
  const open = jobs.filter(job => !job.cancelled && job.executionStatus !== "completed");
  while (open.length) {
    let chosen: { job: Job; engineer: Engineer; route: Job[]; gap: number } | null = null;
    for (const job of open) {
      const costs: Array<{ engineer: Engineer; route: Job[]; score: number }> = [];
      for (const engineer of engineers) {
        if (!compatible(engineer, job)) continue;
        const current = assignments.get(engineer.id)!;
        const before = current.length ? simulate(engineer, current, true, speedKmh, travel)?.distanceKm ?? 0 : 0;
        let best: { route: Job[]; score: number } | null = null;
        for (let position = 0; position <= current.length; position++) {
          const candidate = [...current.slice(0, position), job, ...current.slice(position)];
          const plan = simulate(engineer, candidate, true, speedKmh, travel);
          if (!plan) continue;
          const score = (plan.distanceKm - before) * DISTANCE_WEIGHT + (current.length ? 0 : VEHICLE_COST);
          if (!best || score < best.score) best = { route: candidate, score };
        }
        if (best) costs.push({ engineer, route: best.route, score: best.score });
      }
      if (!costs.length) continue;
      costs.sort((a, b) => a.score - b.score);
      const gap = (costs[1]?.score ?? costs[0].score + INSERT_SOLO_GAP_KM * DISTANCE_WEIGHT) - costs[0].score;
      if (!chosen || gap > chosen.gap) chosen = { job, engineer: costs[0].engineer, route: costs[0].route, gap };
    }
    if (!chosen) break;
    assignments.set(chosen.engineer.id, chosen.route);
    chosen.job.engineerId = chosen.engineer.id;
    const index = open.indexOf(chosen.job);
    open.splice(index, 1);
    emitTrace("insert", `Вставка ${chosen.job.id} → ${chosen.engineer.name}`, engineers, assignments, speedKmh, travel);
  }

  for (const name of regions) {
    const zoneEngineers = engineers.filter(item => item.region === name);
    annealZone(zoneEngineers, assignments, speedKmh, travel, random, zoneBudget);
  }

  recoverUnassigned(engineers, jobs, assignments, speedKmh, travel);
  syncAssignments(engineers, jobs, assignments);
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
  recoverUnassigned(engineers, jobs, assignments, speedKmh, travel);
  syncAssignments(engineers, jobs, assignments);
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
