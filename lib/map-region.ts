import type { Job, Region } from "./vrptw.ts";

/** Keep every stop of a displayed engineer so filtering cannot truncate a road route. */
export function mapJobsForRegion(jobs: Job[], region: Region | "Все зоны", selectedEngineerId: string | null = null): Job[] {
  const active = jobs.filter(job => !job.cancelled);
  if (region === "Все зоны") return active;
  const engineers = new Set(active.filter(job => job.region === region && job.engineerId).map(job => job.engineerId));
  if (selectedEngineerId) engineers.add(selectedEngineerId);
  return active.filter(job => job.region === region || Boolean(job.engineerId && engineers.has(job.engineerId)));
}
