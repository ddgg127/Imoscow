import { BackendRoutingProvider } from "./map-providers";
import { fallbackTravel, mergeTravel, regions, travelFromTable, uniquePoints, type Engineer, type Job, type Region, type TravelMatrix } from "./vrptw";

export async function loadRoadTravel(
  engineers: Engineer[],
  jobs: Job[],
  speedKmh: number,
  options?: { region?: Region; previous?: TravelMatrix },
): Promise<{ travel: TravelMatrix; provider: "osrm" | "fallback" }> {
  const routing = new BackendRoutingProvider("osrm");
  const parts: TravelMatrix[] = options?.previous ? [options.previous] : [];
  let provider: "osrm" | "fallback" = "osrm";
  const names = options?.region ? [options.region] : regions;
  for (const name of names) {
    const points = uniquePoints(engineers.filter(item => item.region === name), jobs.filter(job => job.region === name));
    if (points.length < 2) continue;
    try {
      const table = await routing.buildMatrix(points, "driving");
      if (table.distances.some((row, i) => points.some((_, j) => i !== j && (row?.[j] == null || table.durations[i]?.[j] == null)))) provider = "fallback";
      parts.push(travelFromTable(points, table.distances, table.durations, speedKmh));
    } catch {
      parts.push(fallbackTravel(speedKmh));
      provider = "fallback";
    }
  }
  return { travel: mergeTravel(parts, speedKmh), provider };
}
