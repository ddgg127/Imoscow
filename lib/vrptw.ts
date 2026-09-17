import type { Coordinate } from "./map-providers";

export type Region = "Восток" | "Юго-восток" | "Югоцентр";
export type GeocodeStatus = "precise" | "approximate" | "not_found";
export type Job = {
  id: string; time: string; windowStart: number; windowEnd: number; area: string; address: string;
  kind: string; skillCategory?: string; tone: string; region: Region; engineerId: string | null;
  baselineEngineerId: string | null; coordinates: Coordinate; risk: boolean; equipment: string;
  requiredTransport: string; priority: number; serviceMinutes: number; source: string; status: string;
  geocodeStatus?: GeocodeStatus; geocodeDisplayName?: string | null; sequence?: number;
  plannedArrival?: number; plannedStart?: number; plannedEnd?: number; baselineSequence?: number;
  baselineArrival?: number; baselineStart?: number; baselineEnd?: number; unassignedReason?: string | null;
};
export type Engineer = {
  id: string; initials: string; name: string; route: string; jobs: number; distance: string; load: number;
  color: string; region: Region; start: Coordinate; skills: string[]; equipment: string[]; transport: string;
  shiftStart: number; shiftEnd: number;
};
export type RouteStop = { jobId: string; arrival: number; start: number; end: number; distanceKm: number; onTime: boolean };
export type RoutePlan = { engineerId: string; stops: RouteStop[]; distanceKm: number; durationMinutes: number; load: number };
export type PlanMetrics = { assigned: number; total: number; unassigned: number; distanceKm: number; slaPercent: number; late: number; utilization: number; activeEngineers: number };
export type ZoneMetric = { name: Region; jobs: number; assigned: number; sla: number; distance: number; baselineDistance: number; engineers: number; baselineEngineers: number };
export type OptimizationResult = { jobs: Job[]; routes: RoutePlan[]; baselineRoutes: RoutePlan[]; metrics: PlanMetrics; baseline: PlanMetrics; zones: ZoneMetric[]; runtimeMs: number };

const SPEED_KMH = 32;
const regions: Region[] = ["Восток", "Юго-восток", "Югоцентр"];

export function distanceKm(a: Coordinate, b: Coordinate) {
  const rad = Math.PI / 180;
  const lat1 = a[1] * rad, lat2 = b[1] * rad;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function travelMinutes(a: Coordinate, b: Coordinate) { return distanceKm(a, b) / SPEED_KMH * 60; }
function requiredSkill(job: Job) { return job.skillCategory ?? job.kind; }
function compatible(engineer: Engineer, job: Job) {
  return engineer.region === job.region && engineer.transport === job.requiredTransport && engineer.equipment.includes(job.equipment) && engineer.skills.includes(requiredSkill(job));
}

function simulate(engineer: Engineer, route: Job[], hardWindows = true): RoutePlan | null {
  let point = engineer.start;
  let time = engineer.shiftStart;
  let totalDistance = 0;
  const stops: RouteStop[] = [];
  for (const job of route) {
    const leg = distanceKm(point, job.coordinates);
    const arrival = time + travelMinutes(point, job.coordinates);
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

function metricsFrom(engineers: Engineer[], jobs: Job[], routes: RoutePlan[]): PlanMetrics {
  const activeRoutes = routes.filter(route => route.stops.length);
  const assigned = activeRoutes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = activeRoutes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const distance = activeRoutes.reduce((sum, route) => sum + route.distanceKm, 0);
  const utilization = activeRoutes.length ? activeRoutes.reduce((sum, route) => sum + route.load, 0) / activeRoutes.length : 0;
  return { assigned, total: jobs.length, unassigned: jobs.length - assigned, distanceKm: distance, slaPercent: assigned ? Math.round((assigned - late) / assigned * 1000) / 10 : 0, late, utilization: Math.round(utilization), activeEngineers: activeRoutes.length };
}

// Required baseline: source order, first compatible feasible engineer, visits in assignment order.
function baselinePlan(engineers: Engineer[], jobs: Job[]) {
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const plans = new Map(engineers.map(engineer => [engineer.id, simulate(engineer, [], true)!]));
  for (const job of jobs) {
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const candidate = [...assignments.get(engineer.id)!, job];
      const plan = simulate(engineer, candidate, true);
      if (!plan) continue;
      assignments.set(engineer.id, candidate);
      plans.set(engineer.id, plan);
      break;
    }
  }
  const routes = engineers.map(engineer => plans.get(engineer.id)!).filter(route => route.stops.length);
  return { routes, metrics: metricsFrom(engineers, jobs, routes) };
}

function insertionCandidate(engineer: Engineer, current: Job[], job: Job, currentPlan: RoutePlan) {
  let best: { route: Job[]; plan: RoutePlan; score: number } | null = null;
  for (let position = 0; position <= current.length; position++) {
    const route = [...current.slice(0, position), job, ...current.slice(position)];
    const plan = simulate(engineer, route, true);
    if (!plan) continue;
    const score = (plan.distanceKm - currentPlan.distanceKm) * 100 + plan.durationMinutes * .01;
    if (!best || score < best.score) best = { route, plan, score };
  }
  return best;
}

function unassignedReason(engineers: Engineer[], job: Job) {
  const region = engineers.filter(engineer => engineer.region === job.region);
  if (!region.length) return "Нет инженера в регионе";
  const transport = region.filter(engineer => engineer.transport === job.requiredTransport);
  if (!transport.length) return `Нет транспорта: ${job.requiredTransport}`;
  const equipment = transport.filter(engineer => engineer.equipment.includes(job.equipment));
  if (!equipment.length) return `Нет оборудования: ${job.equipment}`;
  const skills = equipment.filter(engineer => engineer.skills.includes(requiredSkill(job)));
  if (!skills.length) return `Нет навыка: ${requiredSkill(job)}`;
  return "Нет допустимого места в маршруте с учётом окна и смены";
}

export function optimizeVrptw(engineers: Engineer[], inputJobs: Job[]): OptimizationResult {
  const started = performance.now();
  const jobs = inputJobs.map(job => ({ ...job, engineerId: null, risk: false }));
  const baseline = baselinePlan(engineers, jobs);
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const plans = new Map(engineers.map(engineer => [engineer.id, simulate(engineer, [], true)!]));
  const ordered = [...jobs].sort((a, b) => b.priority - a.priority || a.windowEnd - b.windowEnd || a.windowStart - b.windowStart);

  for (const job of ordered) {
    let best: { engineer: Engineer; route: Job[]; plan: RoutePlan; score: number } | null = null;
    const active = engineers.filter(engineer => assignments.get(engineer.id)!.length > 0);
    const inactive = engineers.filter(engineer => assignments.get(engineer.id)!.length === 0);
    // Lexicographic objective: open a new engineer only when no active route can accept the job.
    for (const pool of [active, inactive]) {
      for (const engineer of pool) {
        if (!compatible(engineer, job)) continue;
        const candidate = insertionCandidate(engineer, assignments.get(engineer.id)!, job, plans.get(engineer.id)!);
        if (candidate && (!best || candidate.score < best.score)) best = { engineer, ...candidate };
      }
      if (best) break;
    }
    if (best) {
      assignments.set(best.engineer.id, best.route);
      plans.set(best.engineer.id, best.plan);
    }
  }

  // One-step ejection repair: move a flexible stop elsewhere to make room for a
  // previously unassigned constrained job. This protects coverage before fleet compaction.
  const assignedIds = () => new Set([...assignments.values()].flat().map(job => job.id));
  for (const job of ordered.filter(item => !assignedIds().has(item.id))) {
    let repaired = false;
    for (const source of engineers.filter(engineer => compatible(engineer, job))) {
      const sourceRoute = assignments.get(source.id)!;
      for (const displaced of sourceRoute) {
        const reduced = sourceRoute.filter(item => item.id !== displaced.id);
        const sourceBase = simulate(source, reduced, true);
        if (!sourceBase) continue;
        const sourceCandidate = insertionCandidate(source, reduced, job, sourceBase);
        if (!sourceCandidate) continue;
        const active = engineers.filter(engineer => engineer.id !== source.id && assignments.get(engineer.id)!.length > 0);
        const inactive = engineers.filter(engineer => engineer.id !== source.id && assignments.get(engineer.id)!.length === 0);
        let destination: { engineer: Engineer; route: Job[]; plan: RoutePlan; score: number } | null = null;
        for (const pool of [active, inactive]) {
          for (const engineer of pool) {
            if (!compatible(engineer, displaced)) continue;
            const candidate = insertionCandidate(engineer, assignments.get(engineer.id)!, displaced, plans.get(engineer.id)!);
            if (candidate && (!destination || candidate.score < destination.score)) destination = { engineer, ...candidate };
          }
          if (destination) break;
        }
        if (!destination) continue;
        assignments.set(source.id, sourceCandidate.route);
        plans.set(source.id, sourceCandidate.plan);
        assignments.set(destination.engineer.id, destination.route);
        plans.set(destination.engineer.id, destination.plan);
        repaired = true;
        break;
      }
      if (repaired) break;
    }
  }

  // Route compaction: close the sparsest engineer if every stop can be reinserted elsewhere.
  let compacted = true;
  while (compacted) {
    compacted = false;
    const candidates = engineers.filter(engineer => assignments.get(engineer.id)!.length).sort((a, b) => assignments.get(a.id)!.length - assignments.get(b.id)!.length);
    for (const source of candidates) {
      const trialAssignments = new Map([...assignments].map(([id, route]) => [id, [...route]]));
      const trialPlans = new Map(plans);
      const displaced = [...trialAssignments.get(source.id)!].sort((a, b) => a.windowEnd - b.windowEnd);
      trialAssignments.set(source.id, []);
      trialPlans.set(source.id, simulate(source, [], true)!);
      let feasible = true;
      for (const job of displaced) {
        let best: { engineer: Engineer; route: Job[]; plan: RoutePlan; score: number } | null = null;
        for (const engineer of engineers) {
          if (engineer.id === source.id || !trialAssignments.get(engineer.id)!.length || !compatible(engineer, job)) continue;
          const candidate = insertionCandidate(engineer, trialAssignments.get(engineer.id)!, job, trialPlans.get(engineer.id)!);
          if (candidate && (!best || candidate.score < best.score)) best = { engineer, ...candidate };
        }
        if (!best) { feasible = false; break; }
        trialAssignments.set(best.engineer.id, best.route);
        trialPlans.set(best.engineer.id, best.plan);
      }
      if (!feasible) continue;
      for (const [id, route] of trialAssignments) assignments.set(id, route);
      for (const [id, plan] of trialPlans) plans.set(id, plan);
      compacted = true;
      break;
    }
  }

  const routes = engineers.map(engineer => plans.get(engineer.id)!).filter(route => route.stops.length);
  const optimizedStop = new Map<string, { engineerId: string; stop: RouteStop; sequence: number }>();
  routes.forEach(route => route.stops.forEach((stop, index) => optimizedStop.set(stop.jobId, { engineerId: route.engineerId, stop, sequence: index + 1 })));
  const baselineStop = new Map<string, { engineerId: string; stop: RouteStop; sequence: number }>();
  baseline.routes.forEach(route => route.stops.forEach((stop, index) => baselineStop.set(stop.jobId, { engineerId: route.engineerId, stop, sequence: index + 1 })));
  const resultJobs = jobs.map(job => {
    const optimized = optimizedStop.get(job.id);
    const base = baselineStop.get(job.id);
    return { ...job,
      engineerId: optimized?.engineerId ?? null,
      sequence: optimized?.sequence,
      plannedArrival: optimized?.stop.arrival,
      plannedStart: optimized?.stop.start,
      plannedEnd: optimized?.stop.end,
      baselineEngineerId: base?.engineerId ?? null,
      baselineSequence: base?.sequence,
      baselineArrival: base?.stop.arrival,
      baselineStart: base?.stop.start,
      baselineEnd: base?.stop.end,
      risk: !optimized,
      unassignedReason: optimized ? null : unassignedReason(engineers, job),
    };
  });
  const metrics = metricsFrom(engineers, resultJobs, routes);
  const zones = regions.map(name => {
    const zoneJobs = resultJobs.filter(job => job.region === name);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const zoneRoutes = routes.filter(route => ids.has(route.engineerId));
    const baseRoutes = baseline.routes.filter(route => ids.has(route.engineerId));
    const assigned = zoneRoutes.reduce((sum, route) => sum + route.stops.length, 0);
    const onTime = zoneRoutes.reduce((sum, route) => sum + route.stops.filter(stop => stop.onTime).length, 0);
    return { name, jobs: zoneJobs.length, assigned, sla: assigned ? Math.round(onTime / assigned * 100) : 0, distance: zoneRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: zoneRoutes.length, baselineEngineers: baseRoutes.length };
  });
  return { jobs: resultJobs, routes, baselineRoutes: baseline.routes, metrics, baseline: baseline.metrics, zones, runtimeMs: Math.round((performance.now() - started) * 10) / 10 };
}

export function minutesLabel(value: number) {
  const normalized = Math.max(0, Math.round(value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
