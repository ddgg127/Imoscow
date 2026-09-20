import type { Coordinate } from "./map-providers";

export type Region = "Восток" | "Юго-восток" | "Югоцентр";
export type Job = {
  id: string; time: string; windowStart: number; windowEnd: number; area: string; address: string;
  kind: string; tone: string; region: Region; engineerId: string | null; baselineEngineerId: string | null;
  coordinates: Coordinate; risk: boolean; equipment: string; requiredTransport: string; allowedTransports?: string[]; priority: number;
  serviceMinutes: number; source: string; status: string; workType?: string; cancelled?: boolean;
  baselineUnassignedReason?: string; geocodeVerified?: boolean; geocodeQuality?: "house" | "street" | "fallback"; geocodeDisplayName?: string;
  unassignedReason?: string;
};
export type Engineer = {
  id: string; initials: string; name: string; route: string; jobs: number; distance: string; load: number;
  color: string; region: Region; start: Coordinate; skills: string[]; equipment: string[]; transport: string;
  shiftStart: number; shiftEnd: number;
};
export type RouteStop = { jobId: string; arrival: number; start: number; end: number; distanceKm: number; onTime: boolean };
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
export type ReplanChangeKind = "assignment" | "order" | "route" | "fleet";
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
};
export type OptimizeOptions = { speedKmh?: number; travel?: TravelMatrix; seed?: number; innerBudget?: number; zoneBudget?: number };

const SPEED_KMH = 32;
const SLACK = 0.12;
const P0 = 0.8;
const P_STOP = 0.01;
const VEHICLE_COST = 140;
const WAIT_WEIGHT = 0.35;
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

function travelMinutes(a: Coordinate, b: Coordinate, speedKmh: number, travel?: TravelMatrix) {
  return (travel ?? fallbackTravel(speedKmh)).durationMin(a, b);
}

function travelDistance(a: Coordinate, b: Coordinate, speedKmh: number, travel?: TravelMatrix) {
  return (travel ?? fallbackTravel(speedKmh)).distanceKm(a, b);
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
  return !job.cancelled && engineer.region === job.region && (job.allowedTransports?.includes(engineer.transport) ?? engineer.transport === job.requiredTransport) && engineer.equipment.includes(job.equipment) && engineer.skills.includes(job.kind);
}

function simulate(engineer: Engineer, route: Job[], hardWindows = true, speedKmh = SPEED_KMH, travel?: TravelMatrix): RoutePlan | null {
  let point = engineer.start;
  let time = engineer.shiftStart;
  let totalDistance = 0;
  const stops: RouteStop[] = [];
  for (const job of route) {
    const leg = travelDistance(point, job.coordinates, speedKmh, travel);
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
  const capacity = Math.max(1, engineer.shiftEnd - engineer.shiftStart);
  const slackGap = Math.max(0, plan.durationMinutes - capacity * (1 - SLACK));
  const wait = plan.stops.reduce((sum, stop) => sum + Math.max(0, stop.start - stop.arrival), 0);
  return plan.distanceKm * 10 + wait * WAIT_WEIGHT + slackGap * 0.45 + plan.durationMinutes * 0.01;
}

function insertionScore(engineer: Engineer, currentLength: number, currentScore: number, plan: RoutePlan) {
  return planScore(plan, engineer) - currentScore + (currentLength ? 0 : VEHICLE_COST);
}

function fleetScore(from: Engineer, fromPlan: RoutePlan, to: Engineer, toPlan: RoutePlan, fromJobs: number, toJobs: number) {
  const vehicles = (fromJobs > 0 ? 1 : 0) + (toJobs > 0 ? 1 : 0);
  return planScore(fromPlan, from) + planScore(toPlan, to) + VEHICLE_COST * vehicles;
}

function metricsFrom(engineers: Engineer[], jobs: Job[], routes: RoutePlan[]): PlanMetrics {
  const assigned = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = routes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const distance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  const utilization = routes.length ? routes.reduce((sum, route) => sum + route.load, 0) / routes.length : 0;
  return { assigned, total: jobs.length, unassigned: jobs.length - assigned, activeEngineers: routes.length, distanceKm: distance, slaPercent: assigned ? Math.round((assigned - late) / assigned * 1000) / 10 : 0, late, utilization: Math.round(utilization) };
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
      total += travelDistance(point, job.coordinates, speedKmh, travel);
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
    const compatibleEngineers = engineers.filter(engineer => compatible(engineer, job));
    if (!compatibleEngineers.length) {
      unassignedReasons.set(job.id, "Нет инженера с нужными навыком, оборудованием и транспортом в регионе.");
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
export function compareReplannedPlans(before: OptimizationResult, after: OptimizationResult, engineers: Engineer[]): ReplanChange[] {
  const names = new Map(engineers.map(engineer => [engineer.id, engineer.name]));
  const previous = routePositions(before);
  const next = routePositions(after);
  const changes: ReplanChange[] = [];
  const jobIds = new Set([...before.jobs.map(job => job.id), ...after.jobs.map(job => job.id)]);
  for (const jobId of jobIds) {
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
    const prefix = { engineerId: candidate.id, engineerName: candidate.name || candidate.id, proximityKm: travelDistance(candidate.start, job.coordinates, speedKmh, travel) };
    if (candidate.region !== job.region) return { ...prefix, feasible: false, reason: `другой регион: ${candidate.region}` };
    if (!candidate.skills.includes(job.kind)) return { ...prefix, feasible: false, reason: `нет навыка «${job.kind}»` };
    if (!candidate.equipment.includes(job.equipment)) return { ...prefix, feasible: false, reason: `нет оборудования «${job.equipment}»` };
    if (!(job.allowedTransports?.includes(candidate.transport) ?? candidate.transport === job.requiredTransport)) return { ...prefix, feasible: false, reason: `транспорт «${candidate.transport}» не подходит` };
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

function annealRoute(engineer: Engineer, route: Job[], speedKmh: number, travel: TravelMatrix | undefined, random: () => number, budget: number) {
  if (route.length < 3) return route.slice();
  let current = route.slice();
  let currentPlan = simulate(engineer, current, true, speedKmh, travel);
  if (!currentPlan) return route.slice();
  let best = current;
  let bestPlan = currentPlan;
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
          best = candidate;
          bestPlan = plan;
          improved = true;
        }
      }
    }
  }
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

function relocateOnce(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number, T: number) {
  const donors = zoneEngineers.filter(item => (assignments.get(item.id)?.length ?? 0) > 0);
  if (!donors.length) return;
  const from = donors[Math.floor(random() * donors.length)];
  const fromRoute = assignments.get(from.id)!;
  const jobIndex = Math.floor(random() * fromRoute.length);
  const job = fromRoute[jobIndex];
  const without = fromRoute.filter((_, index) => index !== jobIndex);
  const fromPlan = simulate(from, fromRoute, true, speedKmh, travel);
  const withoutPlan = simulate(from, without, true, speedKmh, travel);
  if (!fromPlan || !withoutPlan) return;
  const targets = zoneEngineers.filter(item => item.id !== from.id && compatible(item, job));
  if (!targets.length) return;
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
  if (!best) return;
  const before = fleetScore(from, fromPlan, to, toPlan, fromRoute.length, toRoute.length);
  const after = fleetScore(from, withoutPlan, to, best.plan, without.length, best.route.length);
  const delta = after - before;
  if (delta <= 0 || random() < Math.exp(-delta / Math.max(T, 1e-6))) {
    assignments.set(from.id, without);
    assignments.set(to.id, best.route);
  }
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
        assignments.set(to.id, candidate.length >= 3 ? annealRoute(to, candidate, speedKmh, travel, random, 80) : candidate);
        assignments.set(from.id, []);
        moved = true;
        break;
      }
      if (moved) break;
    }
  }
}

function annealZone(zoneEngineers: Engineer[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, random: () => number, budget: number) {
  for (const engineer of zoneEngineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (route.length >= 3) assignments.set(engineer.id, annealRoute(engineer, route, speedKmh, travel, random, Math.min(budget, 400)));
  }
  const tau = Math.max(12, budget / 5);
  const mu = expectedPositiveRelocate(zoneEngineers, assignments, speedKmh, travel, random);
  for (let k = 0; k < budget; k++) {
    const p = P0 * Math.exp(-k / tau);
    if (p < P_STOP) break;
    relocateOnce(zoneEngineers, assignments, speedKmh, travel, random, temperature(mu, p));
  }
  for (const engineer of zoneEngineers) {
    const route = assignments.get(engineer.id) ?? [];
    if (route.length >= 3) assignments.set(engineer.id, annealRoute(engineer, route, speedKmh, travel, random, 80));
  }
  compactZone(zoneEngineers, assignments, speedKmh, travel, random);
}

function finish(engineers: Engineer[], inputJobs: Job[], jobs: Job[], assignments: Map<string, Job[]>, speedKmh: number, travel: TravelMatrix | undefined, started: number): OptimizationResult {
  const plans = new Map(engineers.map(engineer => [engineer.id, simulate(engineer, assignments.get(engineer.id) ?? [], true, speedKmh, travel)!]));
  const routes = engineers.map(engineer => plans.get(engineer.id)!).filter(route => route.stops.length);
  const assignmentById = new Map(jobs.map(job => [job.id, job.engineerId]));
  const baseline = baselinePlan(engineers, inputJobs, speedKmh, travel);
  const resultJobs = inputJobs.map(job => {
    const engineerId = assignmentById.get(job.id) ?? null;
    const eligible = engineers.filter(engineer => compatible(engineer, job));
    let unassignedReason: string | undefined;
    if (!engineerId) {
      if (job.cancelled) {
        unassignedReason = "Заявка отменена диспетчером и исключена из расчёта.";
      } else if (!eligible.length) {
        unassignedReason = "В регионе нет инженера с нужным навыком, оборудованием и транспортом.";
      } else if (!eligible.some(engineer => simulate(engineer, [job], true, speedKmh, travel))) {
        const earliest = Math.min(...eligible.map(engineer => engineer.shiftStart + travelMinutes(engineer.start, job.coordinates, speedKmh, travel)));
        unassignedReason = earliest > job.windowEnd
          ? `Даже свободный подходящий инженер приедет не раньше ${minutesLabel(earliest)}, а окно заканчивается в ${minutesLabel(job.windowEnd)}.`
          : "Даже свободный подходящий инженер не успевает выполнить заявку до конца своей смены.";
      } else if (eligible.length === 1) {
        const only = eligible[0];
        const count = assignments.get(only.id)?.length ?? 0;
        unassignedReason = `Единственный подходящий инженер — ${only.name}; у него уже ${count} заявки. Не найдено перестановки, сохраняющей все окна SLA и смену.`;
      } else {
        unassignedReason = `${eligible.length} инженеров подходят по навыку и ресурсам, но после распределения работ не найден допустимый маршрут в пределах SLA и смены.`;
      }
    }
    return { ...job, engineerId, baselineEngineerId: baseline.assignmentById.get(job.id) ?? null, baselineUnassignedReason: baseline.unassignedReasons.get(job.id), unassignedReason, risk: !engineerId };
  });
  const metrics = metricsFrom(engineers, resultJobs, routes);
  const zones = regions.map(name => {
    const zoneJobs = resultJobs.filter(job => job.region === name);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const zoneRoutes = routes.filter(route => ids.has(route.engineerId));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    const assigned = zoneRoutes.reduce((sum, route) => sum + route.stops.length, 0);
    const onTime = zoneRoutes.reduce((sum, route) => sum + route.stops.filter(stop => stop.onTime).length, 0);
    return { name, jobs: zoneJobs.length, assigned, baselineAssigned: baseRoutes.reduce((sum, route) => sum + route.stops.length, 0), sla: assigned ? Math.round(onTime / assigned * 100) : 0, distance: zoneRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: zoneRoutes.length, baselineEngineers: baseRoutes.length };
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
  const jobs: Job[] = inputJobs.map(job => ({ ...job, engineerId: null, risk: false }));
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const ordered = [...jobs].sort((a, b) => b.priority - a.priority || a.windowEnd - b.windowEnd || a.windowStart - b.windowStart);
  const random = rng.bind(null, { value: options.seed ?? hashSeed(inputJobs, engineers) });
  const innerBudget = options.innerBudget ?? 120;
  const zoneBudget = options.zoneBudget ?? 900;

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
    const polished = annealRoute(chosen.engineer, chosen.route, speedKmh, travel, random, innerBudget);
    assignments.set(chosen.engineer.id, polished);
    job.engineerId = chosen.engineer.id;
  }

  for (const name of regions) {
    const zoneEngineers = engineers.filter(item => item.region === name);
    annealZone(zoneEngineers, assignments, speedKmh, travel, random, zoneBudget);
  }

  recoverUnassigned(engineers, jobs, assignments, speedKmh, travel);
  syncAssignments(engineers, jobs, assignments);

  return finish(engineers, inputJobs, jobs, assignments, speedKmh, travel, started);
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
  assignments.set(chosen.engineer.id, annealRoute(chosen.engineer, chosen.route, speedKmh, travel, random, options.innerBudget ?? 180));
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
