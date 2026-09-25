import { comparePlansStrict, compatible, minutesLabel, regions, simulate, type Engineer, type Job, type OptimizationResult, type RoutePlan, type RouteStop, type TravelMatrix } from "./vrptw.ts";

export type DispatchEvent = { type: "new_job" | "cancel_job" | "engineer_unavailable" | "recalculate"; time: number; id: string };

export type TemporalPreparation = {
  event: DispatchEvent;
  lockedRoutes: RoutePlan[];
  lockedJobIds: Set<string>;
  continuationEngineers: Engineer[];
  remainingJobs: Job[];
  pendingOrders: Array<{ engineerId: string; jobIds: string[] }>;
};

/**
 * Событие, которого не было во входном плане. Время берётся из уже
 * согласованных остановок, а не из заранее известного списка.
 */
export function unforeseenEvent(plan: OptimizationResult, engineers: Engineer[], jobs: Job[]): DispatchEvent {
  const starts = plan.routes.flatMap(route => route.stops.map(stop => stop.start)).sort((a, b) => a - b);
  const time = starts.length ? starts[Math.min(starts.length - 1, Math.floor(starts.length / 3))] : 8 * 60 + 30;
  const future = plan.routes.flatMap(route => route.stops.filter(stop => stop.start >= time).map(stop => ({ engineerId: route.engineerId, stop })));
  const ordinary = future.find(item => jobs.find(job => job.id === item.stop.jobId && job.priority < 10 && !job.cancelled));
  if (ordinary) return { type: "cancel_job", time, id: ordinary.stop.jobId };
  const busy = future.find(item => engineers.some(engineer => engineer.id === item.engineerId));
  if (busy) return { type: "engineer_unavailable", time, id: busy.engineerId };
  return { type: "recalculate", time, id: "replan" };
}

/** Cancelling work absent from both calculated plans must not reshuffle any route. */
export function cancelUnassignedJob(previous: OptimizationResult, jobId: string): OptimizationResult {
  const old = previous.jobs.find(job => job.id === jobId);
  if (!old || old.engineerId || old.baselineEngineerId || old.cancelled) throw new Error("Только неназначенную в обоих планах заявку можно отменить без перепланирования.");
  const jobs = previous.jobs.map(job => job.id === jobId ? { ...job, cancelled: true, risk: false, unassignedCategory: "not_applicable" as const, unassignedReason: "Заявка отменена диспетчером после события." } : job);
  const total = previous.metrics.total - 1;
  const baselineTotal = previous.baseline.total - 1;
  return { ...previous, jobs,
    metrics: { ...previous.metrics, total, unassigned: previous.metrics.unassigned - 1, slaPercent: total ? Math.round((previous.metrics.assigned - previous.metrics.late) / total * 1000) / 10 : 0 },
    baseline: { ...previous.baseline, total: baselineTotal, unassigned: previous.baseline.unassigned - 1, slaPercent: baselineTotal ? Math.round((previous.baseline.assigned - previous.baseline.late) / baselineTotal * 1000) / 10 : 0 },
    zones: previous.zones.map(zone => {
      if (zone.name !== old.region) return zone;
      const zoneIds = new Set(previous.jobs.filter(job => job.region === zone.name && !job.cancelled).map(job => job.id));
      const onTime = previous.routes.flatMap(route => route.stops).filter(stop => zoneIds.has(stop.jobId) && stop.onTime).length;
      return { ...zone, jobs: zone.jobs - 1, sla: zone.jobs > 1 ? Math.round(onTime / (zone.jobs - 1) * 100) : 0 };
    }),
    runtimeMs: 0 };
}

/** Freeze work already started, and conservatively finish a leg already underway. */
export function prepareTemporalReplan(previous: OptimizationResult, engineers: Engineer[], jobs: Job[], unavailableIds: string[], event: DispatchEvent): TemporalPreparation {
  if (!Number.isFinite(event.time) || event.time < 0 || event.time > 1440) throw new Error("Укажите корректное время события.");
  const jobById = new Map(previous.jobs.map(job => [job.id, job]));
  const routes = new Map(previous.routes.map(route => [route.engineerId, route]));
  const lockedRoutes: RoutePlan[] = [];
  const lockedJobIds = new Set<string>();
  const pendingOrders: TemporalPreparation["pendingOrders"] = [];
  const continuationEngineers: Engineer[] = [];
  for (const engineer of engineers) {
    const route = routes.get(engineer.id);
    const stops = route?.stops ?? [];
    let lockCount = 0;
    while (lockCount < stops.length && stops[lockCount].start < event.time) lockCount++;
    // If a trip departed before the event, do not teleport the engineer or
    // invalidate the already accepted destination. Complete that visit first.
    if (lockCount < stops.length) {
      const departure = lockCount ? stops[lockCount - 1].end : engineer.shiftStart;
      if (departure < event.time && event.time < stops[lockCount].arrival) lockCount++;
    }
    const prefix = stops.slice(0, lockCount);
    for (const stop of prefix) lockedJobIds.add(stop.jobId);
    if (prefix.length) lockedRoutes.push({ engineerId: engineer.id, stops: prefix, distanceKm: prefix.reduce((sum, stop) => sum + stop.distanceKm, 0), durationMinutes: prefix[prefix.length - 1].end - engineer.shiftStart, load: 0 });
    const pending = stops.slice(lockCount).map(stop => stop.jobId).filter(id => jobs.some(job => job.id === id && !job.cancelled));
    if (pending.length) pendingOrders.push({ engineerId: engineer.id, jobIds: pending });
    if (unavailableIds.includes(engineer.id)) continue;
    const last = prefix[prefix.length - 1];
    continuationEngineers.push({ ...engineer,
      start: last ? [...jobById.get(last.jobId)!.coordinates] as Engineer["start"] : [...engineer.start] as Engineer["start"],
      shiftStart: Math.max(engineer.shiftStart, event.time, last?.end ?? 0),
    });
  }
  if (event.type === "cancel_job" && lockedJobIds.has(event.id)) throw new Error(`№${event.id} уже начата к ${minutesLabel(event.time)} и не может быть отменена.`);
  const remainingJobs = jobs.filter(job => !lockedJobIds.has(job.id) && !job.cancelled && job.executionStatus !== "completed").map(job => ({ ...job, engineerId: null }));
  return { event, lockedRoutes, lockedJobIds, continuationEngineers, remainingJobs, pendingOrders };
}

/** Ordinary work uses only spare gaps; existing client times and order stay fixed. */
export function insertOrdinaryJob(previous: OptimizationResult, prepared: TemporalPreparation, newJob: Job, speedKmh: number, travel: TravelMatrix) {
  const jobs = new Map(prepared.remainingJobs.map(job => [job.id, job]));
  const oldStops = new Map(previous.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const)));
  const orders = new Map(prepared.continuationEngineers.map(engineer => [engineer.id, prepared.pendingOrders.find(order => order.engineerId === engineer.id)?.jobIds ?? []]));
  let best: { engineerId: string; ids: string[]; extraKm: number } | null = null;
  for (const engineer of prepared.continuationEngineers) {
    if (!compatible(engineer, newJob)) continue;
    const current = orders.get(engineer.id) ?? [];
    const base = simulate(engineer, current.map(id => jobs.get(id)!), true, speedKmh, travel);
    if (!base) continue;
    for (let at = 0; at <= current.length; at++) {
      const ids = [...current.slice(0, at), newJob.id, ...current.slice(at)];
      const plan = simulate(engineer, ids.map(id => jobs.get(id)!), true, speedKmh, travel);
      if (!plan) continue;
      if (plan.stops.some(stop => stop.jobId !== newJob.id && (stop.start !== oldStops.get(stop.jobId)?.start || stop.end !== oldStops.get(stop.jobId)?.end))) continue;
      const extraKm = plan.distanceKm - base.distanceKm;
      if (!best || extraKm < best.extraKm) best = { engineerId: engineer.id, ids, extraKm };
    }
  }
  if (best) orders.set(best.engineerId, best.ids);
  return { inserted: Boolean(best), orders: [...orders].filter(([, ids]) => ids.length).map(([engineerId, jobIds]) => ({ engineerId, jobIds })) };
}

/** Stitch suffix solver output onto immutable pre-event stops; never resimulate history. */
export function mergeTemporalResult(previous: OptimizationResult, suffix: OptimizationResult, prepared: TemporalPreparation, engineers: Engineer[], jobs: Job[], speedKmh: number, travel: TravelMatrix): OptimizationResult {
  const locked = new Map(prepared.lockedRoutes.map(route => [route.engineerId, route]));
  const future = new Map(suffix.routes.map(route => [route.engineerId, route]));
  const routes: RoutePlan[] = engineers.map(engineer => {
    const prefix = locked.get(engineer.id)?.stops ?? [];
    const remainder = future.get(engineer.id)?.stops ?? [];
    const stops: RouteStop[] = [...prefix, ...remainder];
    const distanceKm = stops.reduce((sum, stop) => sum + stop.distanceKm, 0);
    const durationMinutes = stops.length ? stops[stops.length - 1].end - engineer.shiftStart : 0;
    return { engineerId: engineer.id, stops, distanceKm, durationMinutes, load: Math.round(durationMinutes / Math.max(1, engineer.shiftEnd - engineer.shiftStart) * 100) };
  }).filter(route => route.stops.length);
  const assignment = new Map(routes.flatMap(route => route.stops.map(stop => [stop.jobId, { engineerId: route.engineerId, stop }] as const)));
  const suffixJobs = new Map(suffix.jobs.map(job => [job.id, job]));
  const previousJobs = new Map(previous.jobs.map(job => [job.id, job]));
  const resultJobs = jobs.map(job => {
    const assigned = assignment.get(job.id);
    const fromSuffix = suffixJobs.get(job.id);
    const old = previousJobs.get(job.id);
    return { ...job, engineerId: assigned?.engineerId ?? null,
      estimatedTravelMinutes: assigned?.stop.travelMinutes ?? job.estimatedTravelMinutes,
      executionStatus: prepared.lockedJobIds.has(job.id) ? (assigned!.stop.end <= prepared.event.time ? "completed" as const : "in_progress" as const) : job.executionStatus,
      baselineEngineerId: old?.baselineEngineerId ?? null,
      unassignedReason: assigned ? undefined : job.cancelled ? "Заявка отменена после события." : fromSuffix?.unassignedReason ?? "После события заявка не вошла в оставшийся план.",
      unassignedCategory: assigned ? undefined : fromSuffix?.unassignedCategory ?? "not_applicable" as const,
      risk: !assigned && !job.cancelled,
    };
  });
  const total = resultJobs.filter(job => !job.cancelled).length;
  const assigned = routes.reduce((sum, route) => sum + route.stops.length, 0);
  const late = routes.reduce((sum, route) => sum + route.stops.filter(stop => !stop.onTime).length, 0);
  const metrics = { assigned, total, unassigned: Math.max(0, total - assigned), activeEngineers: routes.length,
    distanceKm: routes.reduce((sum, route) => sum + route.distanceKm, 0), slaPercent: total ? Math.round((assigned - late) / total * 1000) / 10 : 0,
    late, utilization: routes.length ? Math.round(routes.reduce((sum, route) => sum + route.load, 0) / routes.length) : 0 };
  const baselineRoutes = previous.baselineRoutes;
  const zones = regions.map(name => {
    const zoneJobs = resultJobs.filter(job => job.region === name && !job.cancelled);
    const ids = new Set(engineers.filter(engineer => engineer.region === name).map(engineer => engineer.id));
    const zoneRoutes = routes.filter(route => ids.has(route.engineerId));
    const baseRoutes = baselineRoutes.filter(route => ids.has(route.engineerId));
    const onTime = zoneRoutes.reduce((sum, route) => sum + route.stops.filter(stop => stop.onTime).length, 0);
    return { name, jobs: zoneJobs.length, assigned: zoneRoutes.reduce((sum, route) => sum + route.stops.length, 0), baselineAssigned: baseRoutes.reduce((sum, route) => sum + route.stops.length, 0), sla: zoneJobs.length ? Math.round(onTime / zoneJobs.length * 100) : 0, distance: zoneRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), engineers: zoneRoutes.length, baselineEngineers: baseRoutes.length };
  });
  return { jobs: resultJobs, routes, baselineRoutes, metrics, baseline: previous.baseline,
    comparison: comparePlansStrict(engineers, resultJobs, baselineRoutes, routes, speedKmh, travel), zones, runtimeMs: suffix.runtimeMs };
}
