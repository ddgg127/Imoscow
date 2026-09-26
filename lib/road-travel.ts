import { BackendRoutingProvider, type TravelMode } from "./map-providers";
import { fallbackTravel, mergeTravel, regions, transportAllowed, travelFromTable, uniquePoints, type Engineer, type Job, type Region, type TravelMatrix } from "./vrptw";

export async function loadRoadTravel(
  engineers: Engineer[],
  jobs: Job[],
  speedKmh: number,
  options?: { region?: Region; previous?: TravelMatrix },
): Promise<{ travel: TravelMatrix; provider: "osrm" | "fallback" }> {
  const routing = new BackendRoutingProvider("osrm");
  const modes: TravelMode[] = ["driving", ...(["walking", "cycling"] as const).filter(mode => engineers.some(engineer => mode === "walking" ? ["Пешком", "Пешеход"].includes(engineer.transport) : engineer.transport === "Велосипед"))];
  const parts = new Map<TravelMode, TravelMatrix[]>(modes.map(mode => [mode, options?.previous ? [options.previous.forTransport?.(mode === "walking" ? "Пешком" : mode === "cycling" ? "Велосипед" : "Автомобиль") ?? options.previous] : []]));
  let provider: "osrm" | "fallback" = "osrm";
  // A public-transit timetable matrix is not available from OSRM. Its plan uses
  // the road matrix with a distinct speed/access penalty; do not certify the
  // resulting distance comparison as fully mode-specific.
  if (engineers.some(engineer => engineer.transport === "Общественный транспорт")) provider = "fallback";
  const names = options?.region ? [options.region] : regions;
  const requests: Array<() => Promise<void>> = [];
  for (const mode of modes) {
    for (const name of names) {
      const modeEngineers = mode === "driving" ? engineers.filter(item => item.region === name) : engineers.filter(item => item.region === name && (mode === "walking" ? ["Пешком", "Пешеход"].includes(item.transport) : item.transport === "Велосипед"));
      const modeJobs = jobs.filter(job => job.region === name && modeEngineers.some(engineer => transportAllowed(job, engineer.transport)));
      const points = uniquePoints(modeEngineers, modeJobs);
      if (points.length < 2) continue;
      requests.push(async () => {
        try {
          const table = await routing.buildMatrix(points, mode);
          if (table.distances.some((row, i) => points.some((_, j) => i !== j && (row?.[j] == null || table.durations[i]?.[j] == null)))) provider = "fallback";
          parts.get(mode)!.push(travelFromTable(points, table.distances, table.durations, speedKmh));
        } catch {
          parts.get(mode)!.push(fallbackTravel(speedKmh));
          provider = "fallback";
        }
      });
    }
  }
  for (let offset = 0; offset < requests.length; offset += 3) await Promise.all(requests.slice(offset, offset + 3).map(request => request()));
  const byMode = new Map([...parts].map(([mode, matrices]) => [mode, mergeTravel(matrices, speedKmh)]));
  const driving = byMode.get("driving") ?? fallbackTravel(speedKmh);
  return { travel: { ...driving, forTransport: transport => byMode.get(transport === "Пешком" || transport === "Пешеход" ? "walking" : transport === "Велосипед" ? "cycling" : "driving") ?? driving }, provider };
}
