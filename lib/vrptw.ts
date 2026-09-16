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
export type OptimizationResult = { jobs: Job[]; routes: RoutePlan[]; metrics: PlanMetrics; baseline: PlanMetrics; zones: ZoneMetric[]; runtimeMs: number };

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

function compatible(engineer: Engineer, job: Job) {
  return engineer.region === job.region && engineer.transport === job.requiredTransport && engineer.equipment.includes(job.equipment) && engineer.skills.includes(job.kind);
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
  const assigned = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = routes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const distance = routes.reduce((sum, route) => sum + route.distanceKm, 0);
  const utilization = routes.length ? routes.reduce((sum, route) => sum + route.load, 0) / engineers.length : 0;
  return { assigned, total: jobs.length, unassigned: jobs.length - assigned, distanceKm: distance, slaPercent: assigned ? Math.round((assigned - late) / assigned * 1000) / 10 : 0, late, utilization: Math.round(utilization) };
}

function baselinePlan(engineers: Engineer[], jobs: Job[]) {
  const routes = engineers.map(engineer => {
    const assigned = jobs.filter(job => job.baselineEngineerId === engineer.id).sort((a, b) => a.windowStart - b.windowStart || a.windowEnd - b.windowEnd);
    return simulate(engineer, assigned, false)!;
  });
  return { routes, metrics: metricsFrom(engineers, jobs, routes) };
}

export function optimizeVrptw(engineers: Engineer[], inputJobs: Job[]): OptimizationResult {
  const started = performance.now();
  const jobs = inputJobs.map(job => ({ ...job, engineerId: null, risk: false }));
  const baseline = baselinePlan(engineers, inputJobs);
  const assignments = new Map(engineers.map(engineer => [engineer.id, [] as Job[]]));
  const plans = new Map(engineers.map(engineer => [engineer.id, simulate(engineer, [], true)!]));
  const ordered = [...jobs].sort((a, b) => b.priority - a.priority || a.windowEnd - b.windowEnd || a.windowStart - b.windowStart);

  for (const job of ordered) {
    let best: { engineer: Engineer; route: Job[]; plan: RoutePlan; score: number } | null = null;
    for (const engineer of engineers) {
      if (!compatible(engineer, job)) continue;
      const current = assignments.get(engineer.id)!;
      const currentPlan = plans.get(engineer.id)!;
      for (let position = 0; position <= current.length; position++) {
        const candidate = [...current.slice(0, position), job, ...current.slice(position)];
        const plan = simulate(engineer, candidate, true);
        if (!plan) continue;
        const deltaDistance = plan.distanceKm - currentPlan.distanceKm;
        const score = deltaDistance * 10 + plan.durationMinutes * .015 + plan.load * .05;
        if (!best || score < best.score) best = { engineer, route: candidate, plan, score };
      }
    }
    if (best) {
      assignments.set(best.engineer.id, best.route);
      plans.set(best.engineer.id, best.plan);
      job.engineerId = best.engineer.id;
    }
  }

  const routes = engineers.map(engineer => plans.get(engineer.id)!).filter(route => route.stops.length);
  const assignmentById = new Map(jobs.map(job => [job.id, job.engineerId]));
  const resultJobs = inputJobs.map(job => ({ ...job, engineerId: assignmentById.get(job.id) ?? null, risk: !(assignmentById.get(job.id)) }));
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
  return { jobs: resultJobs, routes, metrics, baseline: baseline.metrics, zones, runtimeMs: Math.round((performance.now() - started) * 10) / 10 };
}

export function minutesLabel(value: number) {
  const normalized = Math.max(0, Math.round(value));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
