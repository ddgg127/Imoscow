import test from "node:test";
import assert from "node:assert/strict";
import { applyAverageWindows, baselinePlan, comparePlans, comparePlansStrict, optimizeVrptw, resultFromRouteOrder } from "../lib/vrptw.ts";
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

test("baseline is deterministic, ignores control assignment and uses feasible cheapest insertion", () => {
  const jobs = [job("late", 1, 510, 580), job("early", 2, 480, 525), job("third", 3, 480, 580)];
  const result = baselinePlan([engineer("e1"), engineer("e2")], jobs, 32, travel);
  assert.deepEqual(result.routes.map(route => [route.engineerId, route.stops.map(stop => stop.jobId)]), [
    ["e1", ["early", "late"]], ["e2", ["third"]],
  ]);
  assert.deepEqual(result.routes, baselinePlan([engineer("e1"), engineer("e2")], jobs, 32, travel).routes);
  assert.equal(result.metrics.assigned, 3);
  assert.equal(result.metrics.activeEngineers, 2);
  assert.equal(result.metrics.late, 0);
  assert.equal(result.metrics.distanceKm, 60);
});

test("baseline leaves impossible jobs unassigned with the right reason", () => {
  const result = baselinePlan([engineer("e1")], [job("skill", 0, 480, 580, "Другое"), job("late", 20, 480, 500), job("ok", 1)], 32, travel);
  assert.deepEqual(result.routes[0].stops.map(stop => stop.jobId), ["ok"]);
  assert.match(result.unassignedReasons.get("skill"), /навыком/);
  assert.match(result.unassignedReasons.get("late"), /окн/);
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

test("CSV baseline routes are feasible and contain no duplicate assignments", () => {
  const result = baselinePlan(csvEngineers, csvJobs);
  const seen = new Set();
  for (const route of result.routes) {
    for (const stop of route.stops) {
      assert.ok(stop.onTime);
      assert.ok(!seen.has(stop.jobId));
      seen.add(stop.jobId);
    }
  }
  assert.equal(seen.size + result.unassignedReasons.size, csvJobs.length);
  assert.equal(result.metrics.activeEngineers, result.routes.length);
});

test("strict comparison measures distance on the common served set", () => {
  const engineers = [engineer("e1"), engineer("e2")];
  const jobs = [job("a", 1), job("b", 2)];
  const baseline = baselinePlan(engineers, jobs, 32, travel);
  const optimized = baselinePlan(engineers, [jobs[0]], 32, travel);
  const comparison = comparePlansStrict(engineers, jobs, baseline.routes, optimized.routes, 32, travel);
  assert.equal(comparison.sameAssignedJobs, false);
  assert.equal(comparison.commonAssigned, 1);
  assert.equal(comparison.baselineOnly, 1);
  assert.equal(comparison.distanceDeltaPercent, 0);
});

test("external route orders are validated before becoming application results", () => {
  const engineers = [engineer("e1")];
  const jobs = [job("a", 1), job("bad", 2, 480, 580, "Другое")];
  const result = resultFromRouteOrder(engineers, jobs, [{ engineerId: "e1", jobIds: ["a"] }], { travel });
  assert.equal(result.metrics.assigned, 1);
  assert.throws(() => resultFromRouteOrder(engineers, jobs, [{ engineerId: "e1", jobIds: ["bad"] }], { travel }), /resources/);
  assert.throws(() => resultFromRouteOrder(engineers, jobs, [{ engineerId: "e1", jobIds: ["a", "a"] }], { travel }), /more than once/);
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
