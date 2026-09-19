import test from "node:test";
import assert from "node:assert/strict";
import { applyAverageWindows, baselinePlan, comparePlans, optimizeVrptw } from "../lib/vrptw.ts";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";

const travel = {
  distanceKm: (a, b) => Math.abs(a[0] - b[0]) * 10,
  durationMin: (a, b) => Math.abs(a[0] - b[0]) * 10,
};
const engineer = (id, skills = ["Монтаж"]) => ({
  id, region: "Восток", transport: "Автомобиль", equipment: ["ONT"], skills,
  start: [0, 0], shiftStart: 480, shiftEnd: 600,
});
const job = (id, x, windowStart = 480, windowEnd = 580, kind = "Монтаж") => ({
  id, region: "Восток", requiredTransport: "Автомобиль", equipment: "ONT", kind,
  coordinates: [x, 0], windowStart, windowEnd, serviceMinutes: 30,
  baselineEngineerId: "e2", priority: 1,
});

test("baseline follows input order, ignores control assignment, and appends to first feasible engineer", () => {
  const jobs = [job("late", 1, 510, 580), job("early", 2, 480, 525), job("third", 3, 480, 580)];
  const result = baselinePlan([engineer("e1"), engineer("e2")], jobs, 32, travel);
  assert.deepEqual(result.routes.map(route => [route.engineerId, route.stops.map(stop => stop.jobId)]), [
    ["e1", ["late", "third"]], ["e2", ["early"]],
  ]);
  assert.equal(result.assignmentById.get("late"), "e1");
  assert.equal(result.metrics.assigned, 3);
  assert.equal(result.metrics.activeEngineers, 2);
  assert.equal(result.metrics.late, 0);
  assert.equal(result.metrics.distanceKm, 50);
});

test("baseline leaves impossible jobs unassigned with the right reason", () => {
  const result = baselinePlan([engineer("e1")], [job("skill", 0, 480, 580, "Другое"), job("late", 20, 480, 500), job("ok", 1)], 32, travel);
  assert.deepEqual(result.routes[0].stops.map(stop => stop.jobId), ["ok"]);
  assert.match(result.unassignedReasons.get("skill"), /навыком/);
  assert.match(result.unassignedReasons.get("late"), /окно/);
  assert.equal(result.metrics.unassigned, 2);
});

test("distance percentage is allowed only for the same served job IDs", () => {
  const base = baselinePlan([engineer("e1")], [job("a", 1), job("b", 2)], 32, travel);
  assert.equal(comparePlans(base.routes, base.routes).distanceDeltaPercent, 0);
  const fewer = baselinePlan([engineer("e1")], [job("a", 1)], 32, travel);
  const comparison = comparePlans(base.routes, fewer.routes);
  assert.equal(comparison.sameAssignedJobs, false);
  assert.equal(comparison.distanceDeltaPercent, null);
});

test("CSV baseline routes are feasible and preserve input order", () => {
  const result = baselinePlan(csvEngineers, csvJobs);
  const positions = new Map(csvJobs.map((item, index) => [item.id, index]));
  const seen = new Set();
  for (const route of result.routes) {
    let previous = -1;
    for (const stop of route.stops) {
      const position = positions.get(stop.jobId);
      assert.ok(position > previous);
      assert.ok(stop.onTime);
      assert.ok(!seen.has(stop.jobId));
      seen.add(stop.jobId);
      previous = position;
    }
  }
  assert.equal(seen.size + result.unassignedReasons.size, csvJobs.length);
  assert.equal(result.metrics.activeEngineers, result.routes.length);
});

test("optimization returns baseline assignments and consistent side-by-side metrics", () => {
  const input = [job("a", 1), job("b", 2)];
  const result = optimizeVrptw([engineer("e1"), engineer("e2")], input, { travel, innerBudget: 4, zoneBudget: 4 });
  assert.equal(result.baseline.assigned, result.baselineRoutes.flatMap(route => route.stops).length);
  assert.equal(result.metrics.activeEngineers, result.routes.length);
  assert.equal(result.jobs.find(item => item.id === "a")?.baselineEngineerId, "e1");
  assert.equal(result.comparison.sameAssignedJobs, true);
});

test("CSV optimization recovers feasible jobs and explains the remaining unassigned ones", () => {
  const input = applyAverageWindows(csvJobs, 240);
  const result = optimizeVrptw(csvEngineers, input, { speedKmh: 24, innerBudget: 160, zoneBudget: 320 });
  const routed = new Map(result.routes.flatMap(route => route.stops.map(stop => [stop.jobId, route.engineerId])));
  assert.ok(result.metrics.assigned >= 202);
  assert.equal(routed.size, result.metrics.assigned);
  for (const item of result.jobs) {
    assert.equal(item.engineerId ?? null, routed.get(item.id) ?? null);
    if (!item.engineerId) assert.match(item.unassignedReason ?? "", /навык|оборудован|окн|смен|возможност/);
  }
});
