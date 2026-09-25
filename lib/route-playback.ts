import type { Coordinate } from "./map-providers.ts";
import { waypointIndices } from "./route-leg.ts";
import { distanceKm, type Engineer, type Job, type RoutePlan } from "./vrptw.ts";

function lengthKm(coords: Coordinate[]) {
  let sum = 0;
  for (let index = 1; index < coords.length; index++) sum += distanceKm(coords[index - 1], coords[index]);
  return sum;
}

function sliceByDistance(coords: Coordinate[], fraction: number) {
  if (coords.length < 2) return { point: coords[0], line: coords };
  const target = lengthKm(coords) * Math.max(0, Math.min(1, fraction));
  const line: Coordinate[] = [coords[0]];
  let covered = 0;
  for (let index = 1; index < coords.length; index++) {
    const segment = distanceKm(coords[index - 1], coords[index]);
    if (covered + segment >= target) {
      const t = segment ? (target - covered) / segment : 1;
      const point: Coordinate = [coords[index - 1][0] + (coords[index][0] - coords[index - 1][0]) * t, coords[index - 1][1] + (coords[index][1] - coords[index - 1][1]) * t];
      return { point, line: [...line, point] };
    }
    covered += segment;
    line.push(coords[index]);
  }
  return { point: coords[coords.length - 1], line: coords };
}

/** Uses only verified road geometry. No straight-line jump is ever animated. */
export function positionAtSimTime(engineer: Engineer, plan: RoutePlan, jobs: Job[], road: Coordinate[], simTime: number) {
  if (road.length < 2) return null;
  const byId = new Map(jobs.map(job => [job.id, job]));
  const waypoints = [engineer.start, ...plan.stops.map(stop => byId.get(stop.jobId)?.coordinates).filter((point): point is Coordinate => Boolean(point))];
  const indices = waypointIndices(road, waypoints);
  if (indices.length !== plan.stops.length + 1) return null;
  if (simTime <= engineer.shiftStart) return { point: road[0], done: false };
  let departure = engineer.shiftStart;
  for (let index = 0; index < plan.stops.length; index++) {
    const stop = plan.stops[index];
    const from = indices[index];
    const to = indices[index + 1];
    if (simTime < stop.arrival) {
      const leg = road.slice(from, to + 1);
      if (leg.length < 2) return null;
      return { point: sliceByDistance(leg, (simTime - departure) / Math.max(1e-6, stop.arrival - departure)).point, done: false };
    }
    if (simTime <= stop.end) return { point: road[to], done: false };
    departure = stop.end;
  }
  return { point: road[road.length - 1], done: true };
}

export function roadLineFeatures(engineers: Engineer[], roads: Record<string, Coordinate[]>, selectedEngineerId: string | null = null) {
  return { type: "FeatureCollection" as const, features: engineers.filter(engineer => !selectedEngineerId || engineer.id === selectedEngineerId).flatMap(engineer => {
    const coordinates = roads[engineer.id];
    return coordinates?.length >= 2 ? [{ type: "Feature" as const, properties: { id: engineer.id, color: engineer.color, selected: selectedEngineerId === engineer.id ? 1 : 0, opacity: 1 }, geometry: { type: "LineString" as const, coordinates } }] : [];
  }) };
}
