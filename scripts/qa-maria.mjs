import { generateTzDataset } from "../lib/generator-files.ts";
import assert from "node:assert/strict";
import { issueDailyEquipment } from "../lib/equipment-issue.ts";
import { createSolverPayload } from "../lib/server-solver.ts";
import { compatible, fallbackTravel, resultFromRouteOrder, simulate } from "../lib/vrptw.ts";

const data = generateTzDataset({ engineers: 12, jobs: 51, windowMinutes: 240, speedKmh: 24, seed: 42 });
const travel = fallbackTravel(data.speedKmh);
const engineers = issueDailyEquipment(data.engineers, data.jobs, travel, data.speedKmh);
const maria = engineers.find(engineer => engineer.name === "Мария Козлова");
if (!maria) throw new Error("Expected Maria Kozlova in the deterministic scenario");
assert.deepEqual(maria.equipment, ["Аварийный комплект"]);
assert.equal(compatible(maria, data.jobs.find(job => job.id === "0012")), true);
assert.equal(compatible(maria, data.jobs.find(job => job.id === "0015")), true);
assert.equal(compatible(maria, data.jobs.find(job => job.id === "0018")), false);
console.log(JSON.stringify({ maria: { id: maria.id, region: maria.region, transport: maria.transport, equipment: maria.equipment }, jobs: data.jobs.filter(job => ["0012", "0015", "0018", "0031"].includes(job.id)).map(job => ({ id: job.id, region: job.region, requiredTransport: job.requiredTransport, compatible: compatible(maria, job), feasibleAlone: compatible(maria, job) && Boolean(simulate(maria, [job], true, data.speedKmh, travel)) })) }));

// Exhaustive certificate for this fixture's fixed kit assignment: these seven
// GPON visits have one possible carrier, and no ordering of all seven fits.
const gponCarrier = engineers.find(engineer => engineer.id === "E012");
const exclusive = data.jobs.filter(job => compatible(gponCarrier, job) && engineers.filter(engineer => compatible(engineer, job)).length === 1);
assert.equal(exclusive.length, 7);
let permutations = 0;
const canServeAll = (remaining, route = []) => {
  if (!remaining.length) { permutations++; return Boolean(simulate(gponCarrier, route, true, data.speedKmh, travel)); }
  return remaining.some((job, at) => canServeAll(remaining.filter((_, index) => index !== at), [...route, job]));
};
assert.equal(canServeAll(exclusive), false);
assert.equal(permutations, 5040);
console.log(JSON.stringify({ fixedKitUpperBound: 50, exclusiveEngineer: gponCarrier.id, exclusiveJobs: exclusive.map(job => job.id), checkedPermutations: permutations }));

for (const seconds of process.argv.slice(2).map(Number).filter(Number.isFinite).length ? process.argv.slice(2).map(Number).filter(Number.isFinite) : [12, 30]) {
  const payload = createSolverPayload(engineers, data.jobs, data.speedKmh, travel);
  payload.timeLimitSeconds = seconds;
  const response = await fetch(process.env.FIELD_FLOW_SOLVER_CHECK_URL ?? "http://127.0.0.1:8008/solve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const solved = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(solved));
  const result = resultFromRouteOrder(engineers, data.jobs, solved.routes, { speedKmh: data.speedKmh, travel });
  const missing = result.jobs.filter(job => !job.engineerId).map(job => job.id);
  const mariaRoute = result.routes.find(route => route.engineerId === maria.id);
  assert.ok(result.metrics.assigned >= (seconds >= 30 ? 50 : 49), `Only ${result.metrics.assigned}/51 assigned`);
  assert.ok((mariaRoute?.stops.length ?? 0) >= 2, "Maria still has only one visit");
  assert.ok(result.jobs.filter(job => job.priority === 2).every(job => job.engineerId), "Elevated work was dropped");
  assert.equal(result.zones.reduce((sum, zone) => sum + zone.assigned, 0), result.metrics.assigned, "Zone totals disagree with coverage");
  const triviallyInsertable = missing.flatMap(id => {
    const job = data.jobs.find(item => item.id === id);
    return engineers.flatMap(engineer => {
      if (!compatible(engineer, job)) return [];
      const route = result.routes.find(item => item.engineerId === engineer.id)?.stops.map(stop => data.jobs.find(item => item.id === stop.jobId)) ?? [];
      return Array.from({ length: route.length + 1 }, (_, at) => [...route.slice(0, at), job, ...route.slice(at)]).some(candidate => simulate(engineer, candidate, true, data.speedKmh, travel)) ? [{ job: id, engineer: engineer.id }] : [];
    });
  });
  console.log(JSON.stringify({ seconds, solverMs: solved.runtimeMs, assigned: result.metrics.assigned, missing, mariaRoute: mariaRoute?.stops.map(stop => stop.jobId) ?? [], triviallyInsertable }));
}
