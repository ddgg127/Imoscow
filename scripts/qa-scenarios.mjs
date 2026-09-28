import assert from "node:assert/strict";
import demo from "../data/demo-scenario.json" with { type: "json" };
import { generateTzDataset } from "../lib/generator-files.ts";
import { issueDailyEquipment } from "../lib/equipment-issue.ts";
import { importPlanText } from "../lib/import-data.ts";
import { createSolverPayload } from "../lib/server-solver.ts";
import { cancelJobLocally, cancelUnassignedJob } from "../lib/temporal-replan.ts";
import { compareReplannedPlans, fallbackTravel, resultFromRouteOrder } from "../lib/vrptw.ts";

const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
const solverUrl = process.env.FIELD_FLOW_SOLVER_CHECK_URL ?? "http://127.0.0.1:8008/solve";
const scenarios = [
  ["пример 12/51", () => {
    const imported = importPlanText(JSON.stringify(demo), "demo-scenario.json", centers);
    return { jobs: imported.jobs, engineers: imported.engineers, speedKmh: 24 };
  }],
  ...[[12, 51], [25, 200], [35, 250]].map(([engineers, jobs]) => [`генератор ${engineers}/${jobs}`, () => generateTzDataset({ engineers, jobs, windowMinutes: 240, speedKmh: 24, seed: 42 })]),
];

for (const [name, make] of scenarios) {
  const input = make();
  const travel = fallbackTravel(input.speedKmh);
  const engineers = issueDailyEquipment(input.engineers, input.jobs, travel, input.speedKmh);
  assert.ok(engineers.every(engineer => engineer.equipment.length <= 1), `${name}: multiple kits`);
  const payload = createSolverPayload(engineers, input.jobs, input.speedKmh, travel);
  const response = await fetch(solverUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const solved = await response.json();
  assert.equal(response.status, 200, `${name}: ${JSON.stringify(solved)}`);
  assert.equal(solved.engine, "ortools", `${name}: wrong solver engine`);
  const result = resultFromRouteOrder(engineers, input.jobs, solved.routes, { speedKmh: input.speedKmh, travel });
  assert.equal(result.metrics.total, input.jobs.length);
  const routeIds = result.routes.flatMap(route => route.stops.map(stop => stop.jobId));
  assert.equal(new Set(routeIds).size, routeIds.length, `${name}: duplicate assignment`);
  const future = result.routes.flatMap(route => route.stops).find(stop => stop.start > 660);
  assert.ok(future, `${name}: no future job for cancellation`);
  const time = Math.min(600, future.start - 1);
  const cancelledJobs = input.jobs.map(job => job.id === future.jobId ? { ...job, cancelled: true } : job);
  const cancelled = cancelJobLocally(result, engineers, cancelledJobs, { type: "cancel_job", time, id: future.jobId }, input.speedKmh, travel);
  assert.ok(!cancelled.result.routes.some(route => route.stops.some(stop => stop.jobId === future.jobId)), `${name}: cancelled job survived`);
  const owner = result.routes.find(route => route.stops.some(stop => stop.jobId === future.jobId)).engineerId;
  for (const route of result.routes.filter(route => route.engineerId !== owner)) {
    assert.deepEqual(cancelled.result.routes.find(item => item.engineerId === route.engineerId)?.stops, route.stops, `${name}: colleague schedule changed`);
  }
  assert.equal(compareReplannedPlans(result, cancelled.result, engineers, time, { type: "cancel_job", id: future.jobId }).filter(change => change.kind === "order").length, 0, `${name}: cancelling a visit was reported as route reordering`);
  const active = result.routes.flatMap(route => route.stops).find(stop => stop.end - stop.start >= 2);
  assert.ok(active);
  for (const [label, eventTime] of [["active", Math.ceil((active.start + active.end) / 2)], ["completed", Math.ceil(active.end + 1)]]) {
    assert.throws(() => cancelJobLocally(result, engineers, input.jobs.map(job => job.id === active.jobId ? { ...job, cancelled: true } : job), { type: "cancel_job", time: eventTime, id: active.jobId }, input.speedKmh, travel), /уже начата/, `${name}: ${label} cancellation allowed`);
  }
  const unassigned = result.jobs.find(job => !job.engineerId && !job.cancelled);
  if (unassigned) {
    const unchanged = cancelUnassignedJob(result, unassigned.id, engineers, input.speedKmh, travel);
    assert.deepEqual(unchanged.routes, result.routes, `${name}: unassigned cancellation changed routes`);
  }
  const elevated = result.jobs.filter(job => job.priority === 2 || job.urgency === "urgent");
  const missedElevated = elevated.filter(job => !job.engineerId).map(job => job.id);
  const singleJobRoutes = result.routes.filter(route => route.stops.length === 1).length;
  console.log(JSON.stringify({ scenario: name, engineers: engineers.length, jobs: input.jobs.length, assigned: result.metrics.assigned, elevated: elevated.length, missedElevated, activeEngineers: result.routes.length, singleJobRoutes, distanceKm: Number(result.metrics.distanceKm.toFixed(1)), baselineAssigned: result.baseline.assigned, minWindow: Math.min(...input.jobs.map(job => job.windowEnd - job.windowStart)), maxWindow: Math.max(...input.jobs.map(job => job.windowEnd - job.windowStart)), cancelled: future.jobId, replacement: cancelled.replacementId, solverMs: solved.runtimeMs }));
}
