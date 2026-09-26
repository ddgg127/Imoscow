import type { Coordinate } from "./map-providers";
import { distanceKm, type Engineer, type Job, type RoutePlan } from "./vrptw.ts";

export function waypointIndices(coords: Coordinate[], waypoints: Coordinate[]) {
  const indices = [0];
  let from = 0;
  for (let i = 1; i < waypoints.length; i++) {
    let best = from;
    let bestDistance = Infinity;
    for (let j = from; j < coords.length; j++) {
      const next = distanceKm(coords[j], waypoints[i]);
      if (next < bestDistance) { bestDistance = next; best = j; }
    }
    indices.push(best);
    from = best;
  }
  return indices;
}

export function roadLegForJob(engineer: Engineer, plan: RoutePlan, jobs: Job[], road: Coordinate[], jobId: string, legEnds?: number[]) {
  const stopIndex = plan.stops.findIndex(stop => stop.jobId === jobId);
  if (stopIndex < 0) return null;
  const byId = new Map(jobs.map(job => [job.id, job]));
  const job = byId.get(jobId);
  if (!job) return null;
  const previous = stopIndex > 0 ? byId.get(plan.stops[stopIndex - 1].jobId) : undefined;
  const origin = previous?.coordinates ?? engineer.start;
  const waypoints = [engineer.start, ...plan.stops.map(stop => byId.get(stop.jobId)?.coordinates).filter((point): point is Coordinate => Boolean(point))];
  const indices = legEnds?.length === plan.stops.length + 1 ? legEnds : waypointIndices(road, waypoints);
  const from = indices[stopIndex] ?? 0;
  const to = indices[stopIndex + 1] ?? road.length - 1;
  const coordinates = road.length >= 2 && to > from ? road.slice(from, to + 1) : [];
  return { origin, destination: job.coordinates, originLabel: previous ? `Заявка № ${previous.id}` : `База: ${engineer.name}`, destinationLabel: `Заявка № ${job.id}`, stop: plan.stops[stopIndex], coordinates };
}
