import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import { createSolverPayload } from "../lib/server-solver.ts";
import { applyAverageWindows, fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";

const engineers = csvEngineers;
const jobs = applyAverageWindows(csvJobs, 240);
const speedKmh = 24;
const travel = fallbackTravel(speedKmh);
const payload = createSolverPayload(engineers, jobs, speedKmh, travel);
payload.timeLimitSeconds = 12;
const endpoint = `${process.env.SOLVER_URL ?? "http://127.0.0.1:8000"}/solve`;
const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
if (!response.ok) throw new Error(`Solver audit failed: ${response.status} ${await response.text()}`);
const solved = await response.json();
const result = resultFromRouteOrder(engineers, jobs, solved.routes, { speedKmh, travel });
const active = new Set(solved.routes.map(route => route.engineerId));
const idle = engineers.filter(engineer => !active.has(engineer.id));
const compatible = (engineer, job) => engineer.region === job.region && engineer.transport === job.requiredTransport && engineer.equipment.includes(job.equipment) && engineer.skills.includes(job.kind);
const soloFeasible = (engineer, job) => {
  const arrival = engineer.shiftStart + travel.durationMin(engineer.start, job.coordinates);
  const start = Math.max(arrival, job.windowStart);
  return start <= job.windowEnd && start + job.serviceMinutes <= engineer.shiftEnd;
};
const idleCoverageViolations = result.jobs.filter(job => !job.engineerId && idle.some(engineer => compatible(engineer, job) && soloFeasible(engineer, job)));
const duplicateIds = solved.routes.flatMap(route => route.jobIds).filter((id, index, all) => all.indexOf(id) !== index);
const report = {
  engine: solved.engine,
  status: solved.status,
  total: result.metrics.total,
  assigned: result.metrics.assigned,
  unassigned: result.metrics.unassigned,
  activeEngineers: result.metrics.activeEngineers,
  idleEngineers: idle.length,
  distanceKm: Number(result.metrics.distanceKm.toFixed(1)),
  baselineAssigned: result.baseline.assigned,
  baselineActiveEngineers: result.baseline.activeEngineers,
  idleCoverageViolations: idleCoverageViolations.map(job => job.id),
  duplicateIds,
};
console.log(JSON.stringify(report, null, 2));
if (duplicateIds.length || idleCoverageViolations.length) process.exitCode = 1;
