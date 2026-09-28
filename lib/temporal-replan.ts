import { comparePlansStrict, compatible, jobPriorityLevel, minutesLabel, regions, resultFromRouteOrder, routeTimeBreakdown, simulate, type Engineer, type Job, type OptimizationResult, type RoutePlan, type RouteStop, type TravelMatrix } from "./vrptw.ts";

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
  const ordinary = future.find(item => jobs.find(job => job.id === item.stop.jobId && jobPriorityLevel(job) === 1 && !job.cancelled));
  if (ordinary) return { type: "cancel_job", time, id: ordinary.stop.jobId };
  const busy = future.find(item => engineers.some(engineer => engineer.id === item.engineerId));
  if (busy) return { type: "engineer_unavailable", time, id: busy.engineerId };
  return { type: "recalculate", time, id: "replan" };
}

/** Cancelling unassigned work must not resimulate any agreed route. */
export function cancelUnassignedJob(previous: OptimizationResult, jobId: string, engineers: Engineer[], speedKmh = 24, travel?: TravelMatrix | null): OptimizationResult {
  const old = previous.jobs.find(job => job.id === jobId);
  if (!old || old.engineerId || old.cancelled) throw new Error("Только неназначенную заявку можно отменить без перепланирования.");
  const jobs = previous.jobs.map(job => job.id === jobId ? { ...job, cancelled: true, risk: false, baselineEngineerId: null, unassignedCategory: "not_applicable" as const, unassignedReason: "Заявка отменена диспетчером после события." } : job);
  const total = previous.metrics.total - 1;
  const baselineTotal = previous.baseline.total - 1;
  const baselineRemoved = previous.baselineRoutes.some(route => route.stops.some(stop => stop.jobId === jobId));
  const baselineRoutes = previous.baselineRoutes.map(route => {
    const stops = route.stops.filter(stop => stop.jobId !== jobId);
    return { ...route, stops, distanceKm: stops.reduce((sum, stop) => sum + stop.distanceKm, 0) };
  }).filter(route => route.stops.length);
  return { ...previous, jobs,
    metrics: { ...previous.metrics, total, unassigned: previous.metrics.unassigned - 1, slaPercent: total ? Math.round((previous.metrics.assigned - previous.metrics.late) / total * 1000) / 10 : 0 },
    baselineRoutes,
    comparison: comparePlansStrict(engineers, jobs, baselineRoutes, previous.routes, speedKmh, travel ?? undefined),
    baseline: { ...previous.baseline, total: baselineTotal, assigned: previous.baseline.assigned - Number(baselineRemoved), unassigned: previous.baseline.unassigned - Number(!baselineRemoved), activeEngineers: baselineRoutes.length, distanceKm: baselineRoutes.reduce((sum, route) => sum + route.distanceKm, 0), slaPercent: baselineTotal ? Math.round((previous.baseline.assigned - Number(baselineRemoved) - previous.baseline.late) / baselineTotal * 1000) / 10 : 0 },
    zones: previous.zones.map(zone => {
      const ids = new Set(engineers.filter(engineer => engineer.region === zone.name).map(engineer => engineer.id));
      const baseRoutes = baselineRoutes.filter(route => ids.has(route.engineerId));
      const count = zone.jobs - Number(zone.name === old.region);
      const onTime = previous.routes.filter(route => ids.has(route.engineerId)).flatMap(route => route.stops).filter(stop => stop.onTime).length;
      return { ...zone, jobs: count, sla: count ? Math.round(onTime / count * 100) : 0,
        baselineAssigned: baseRoutes.reduce((sum, route) => sum + route.stops.length, 0),
        baselineDistance: baseRoutes.reduce((sum, route) => sum + route.distanceKm, 0), baselineEngineers: baseRoutes.length };
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
    while (lockCount < stops.length && stops[lockCount].start <= event.time) lockCount++;
    // An unavailable engineer may finish an active visit, but a trip or a
    // wait at the next address does not reserve that next job for them.
    if (!unavailableIds.includes(engineer.id) && lockCount < stops.length) {
      const departure = lockCount ? stops[lockCount - 1].end : engineer.shiftStart;
      if (departure < event.time && event.time < stops[lockCount].arrival && !(event.type === "cancel_job" && stops[lockCount].jobId === event.id)) lockCount++;
    }
    const prefix = stops.slice(0, lockCount);
    for (const stop of prefix) lockedJobIds.add(stop.jobId);
    if (prefix.length) lockedRoutes.push({ engineerId: engineer.id, stops: prefix, distanceKm: prefix.reduce((sum, stop) => sum + stop.distanceKm, 0), durationMinutes: prefix[prefix.length - 1].end - engineer.shiftStart, load: 0 });
    const pending = stops.slice(lockCount).map(stop => stop.jobId).filter(id => jobs.some(job => job.id === id && !job.cancelled));
    if (pending.length) pendingOrders.push({ engineerId: engineer.id, jobIds: pending });
    if (unavailableIds.includes(engineer.id)) continue;
    const last = prefix[prefix.length - 1];
    let start = last ? [...jobById.get(last.jobId)!.coordinates] as Engineer["start"] : [...engineer.start] as Engineer["start"];
    const destination = stops[lockCount];
    if (event.type === "cancel_job" && destination?.jobId === event.id && event.time < destination.start) {
      const target = jobById.get(event.id)?.coordinates;
      if (target && event.time >= destination.arrival) start = [...target] as Engineer["start"];
      else if (target) {
        const departure = last?.end ?? engineer.shiftStart;
        const fraction = Math.max(0, Math.min(1, (event.time - departure) / Math.max(1, destination.arrival - departure)));
        start = [start[0] + (target[0] - start[0]) * fraction, start[1] + (target[1] - start[1]) * fraction];
      }
    }
    continuationEngineers.push({ ...engineer,
      start,
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
    return { engineerId: engineer.id, stops, distanceKm, durationMinutes, load: routeTimeBreakdown(stops, engineer.shiftEnd - engineer.shiftStart).load };
  }).filter(route => route.stops.length);
  const assignedJobIds = routes.flatMap(route => route.stops.map(stop => stop.jobId));
  if (new Set(assignedJobIds).size !== assignedJobIds.length) throw new Error("После события одна заявка оказалась в нескольких маршрутах.");
  const assignment = new Map(routes.flatMap(route => route.stops.map(stop => [stop.jobId, { engineerId: route.engineerId, stop }] as const)));
  const suffixJobs = new Map(suffix.jobs.map(job => [job.id, job]));
  const previousJobs = new Map(previous.jobs.map(job => [job.id, job]));
  const resultJobs = jobs.map(job => {
    const assigned = assignment.get(job.id);
    const fromSuffix = suffixJobs.get(job.id);
    const old = previousJobs.get(job.id);
    return { ...job, engineerId: assigned?.engineerId ?? null,
      estimatedTravelMinutes: assigned?.stop.travelMinutes ?? job.estimatedTravelMinutes,
      executionStatus: prepared.lockedJobIds.has(job.id) && assigned!.stop.start <= prepared.event.time ? (assigned!.stop.end <= prepared.event.time ? "completed" as const : "in_progress" as const) : job.executionStatus,
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
    const zoneIds = new Set(zoneJobs.map(job => job.id));
    const selected = (plans: typeof routes) => plans.flatMap(route => route.stops.filter(stop => zoneIds.has(stop.jobId)).map(stop => ({ engineerId: route.engineerId, stop })));
    const zoneStops = selected(routes);
    const baseStops = selected(baselineRoutes);
    const onTime = zoneStops.filter(item => item.stop.onTime).length;
    return { name, jobs: zoneJobs.length, assigned: zoneStops.length, baselineAssigned: baseStops.length, sla: zoneJobs.length ? Math.round(onTime / zoneJobs.length * 100) : 0, distance: zoneStops.reduce((sum, item) => sum + item.stop.distanceKm, 0), baselineDistance: baseStops.reduce((sum, item) => sum + item.stop.distanceKm, 0), engineers: new Set(zoneStops.map(item => item.engineerId)).size, baselineEngineers: new Set(baseStops.map(item => item.engineerId)).size };
  });
  return { jobs: resultJobs, routes, baselineRoutes, metrics, baseline: previous.baseline,
    comparison: comparePlansStrict(engineers, resultJobs, baselineRoutes, routes, speedKmh, travel), zones, runtimeMs: suffix.runtimeMs };
}

/** Cancel a future visit without changing another engineer's route or agreed visit times. */
export function cancelJobLocally(previous: OptimizationResult, engineers: Engineer[], jobs: Job[], event: DispatchEvent, speedKmh: number, travel: TravelMatrix) {
  const owner = previous.routes.find(route => route.stops.some(stop => stop.jobId === event.id));
  if (!owner) throw new Error(`№${event.id} не назначена инженеру.`);
  const prepared = prepareTemporalReplan(previous, engineers, jobs, [], event);
  const oldStops = new Map(previous.routes.flatMap(route => route.stops.map(stop => [stop.jobId, stop] as const)));
  // Other engineers' entire routes are immutable, including future visits.
  for (const route of previous.routes) {
    if (route.engineerId === owner.engineerId) continue;
    const index = prepared.lockedRoutes.findIndex(item => item.engineerId === route.engineerId);
    if (index >= 0) prepared.lockedRoutes[index] = route;
    else prepared.lockedRoutes.push(route);
    for (const stop of route.stops) prepared.lockedJobIds.add(stop.jobId);
  }
  prepared.pendingOrders = prepared.pendingOrders.filter(order => order.engineerId === owner.engineerId);
  prepared.continuationEngineers = prepared.continuationEngineers.filter(engineer => engineer.id === owner.engineerId);
  prepared.remainingJobs = prepared.remainingJobs.filter(job => !prepared.lockedJobIds.has(job.id) && (!oldStops.has(job.id) || owner.stops.some(stop => stop.jobId === job.id)));
  // A free gap may receive only a previously unassigned task compatible with this engineer.
  const unassigned = prepared.remainingJobs.filter(job => !oldStops.has(job.id)).sort((a, b) => jobPriorityLevel(b) - jobPriorityLevel(a) || a.windowEnd - b.windowEnd || a.id.localeCompare(b.id));
  const originalOrder = prepared.pendingOrders.find(order => order.engineerId === owner.engineerId)?.jobIds ?? [];
  const scheduledJobs = prepared.remainingJobs.map(job => ({ ...job, windowStart: oldStops.has(job.id) ? Math.max(job.windowStart, oldStops.get(job.id)!.start) : job.windowStart }));
  const assignedJobs = new Map(scheduledJobs.map(job => [job.id, job]));
  const engineer = prepared.continuationEngineers[0];
  if (!engineer) throw new Error("Инженер отменяемой заявки недоступен.");
  let selected: { id: string; order: string[]; distanceKm: number } | null = null;
  for (const candidate of unassigned) {
    if (!compatible(engineer, candidate)) continue;
    for (let at = 0; at <= originalOrder.length; at++) {
      const order = [...originalOrder.slice(0, at), candidate.id, ...originalOrder.slice(at)];
      const route = simulate(engineer, order.map(id => assignedJobs.get(id)!), true, speedKmh, travel);
      if (!route || route.stops.some(stop => stop.jobId !== candidate.id && (stop.start !== oldStops.get(stop.jobId)?.start || stop.end !== oldStops.get(stop.jobId)?.end))) continue;
      if (!selected || route.distanceKm < selected.distanceKm) selected = { id: candidate.id, order, distanceKm: route.distanceKm };
    }
    if (selected) break; // Priority and deadline order outrank saved distance.
  }
  const chosen = selected as { id: string; order: string[]; distanceKm: number } | null;
  const order = chosen?.order ?? originalOrder;
  const suffix = resultFromRouteOrder([engineer], scheduledJobs, order.length ? [{ engineerId: engineer.id, jobIds: order }] : [], { speedKmh, travel });
  const merged = mergeTemporalResult(previous, suffix, prepared, engineers, jobs, speedKmh, travel);
  for (const route of previous.routes) {
    if (route.engineerId === owner.engineerId) continue;
    const current = merged.routes.find(item => item.engineerId === route.engineerId);
    if (JSON.stringify(current?.stops) !== JSON.stringify(route.stops)) throw new Error("Чужой маршрут изменился при отмене заявки.");
  }
  if (merged.routes.find(route => route.engineerId === owner.engineerId)?.stops.some(stop => stop.jobId !== chosen?.id && (stop.start !== oldStops.get(stop.jobId)?.start || stop.end !== oldStops.get(stop.jobId)?.end))) throw new Error("Отмена сдвинула согласованную работу инженера.");
  return { result: merged, engineerId: owner.engineerId, replacementId: chosen?.id ?? null };
}
