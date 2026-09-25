import test from "node:test";
import assert from "node:assert/strict";
import {
  VEHICLE_COST,
  compatible,
  compatibilityFailure,
  compareJobsForInsertion,
  compareJobsForRecovery,
  insertionScore,
  pickInsertion,
  reasonJobUnassigned,
  scoreAssignedRoute,
  vehicleActivationPenalty,
} from "../lib/assignment.ts";

const engineer = (id, extra = {}) => ({
  id, name: id, region: "Восток", transport: "Автомобиль", equipment: ["ONT"], skills: ["Монтаж"],
  start: [0, 0], shiftStart: 480, shiftEnd: 720, ...extra,
});
const job = (id, extra = {}) => ({
  id, region: "Восток", requiredTransport: "Автомобиль", equipment: "ONT", kind: "Монтаж",
  coordinates: [1, 0], windowStart: 480, windowEnd: 600, serviceMinutes: 30, priority: 1, ...extra,
});
const plan = (distanceKm, durationMinutes = 60, wait = 0) => ({
  engineerId: "e1",
  distanceKm,
  durationMinutes,
  load: 20,
  stops: [{ jobId: "a", arrival: 480, start: 480 + wait, end: 510 + wait, distanceKm, onTime: true }],
});

test("resource filter keeps only same region, skill, equipment and allowed transport", () => {
  const base = engineer("e1");
  const task = job("a");
  assert.equal(compatible(base, task), true);
  assert.equal(compatible(base, job("a", { cancelled: true })), false);
  assert.equal(compatibilityFailure(engineer("e1", { region: "Югоцентр" }), task), "другой регион: Югоцентр");
  assert.equal(compatibilityFailure(engineer("e1", { skills: ["Диагностика"] }), task), "нет навыка «Монтаж»");
  assert.equal(compatibilityFailure(engineer("e1", { equipment: ["Рефлектометр"] }), task), "нет оборудования «ONT»");
  assert.equal(compatibilityFailure(engineer("e1", { transport: "Пешеход" }), task), "транспорт «Пешеход» не подходит");
  assert.equal(compatible(engineer("e1", { transport: "Велосипед" }), job("a", { allowedTransports: ["Велосипед", "Автомобиль"] })), true);
});

test("construction queue prefers urgent jobs and earlier windows", () => {
  const urgent = job("u", { priority: 10, windowEnd: 700 });
  const tight = job("t", { priority: 1, windowEnd: 520 });
  const loose = job("l", { priority: 1, windowEnd: 800, windowStart: 500 });
  const ordered = [loose, urgent, tight].sort(compareJobsForInsertion);
  assert.deepEqual(ordered.map(item => item.id), ["u", "t", "l"]);
});

test("recovery queue prefers jobs that fewer engineers can take", () => {
  const engineers = [engineer("e1"), engineer("e2", { skills: ["Монтаж", "Аварийные работы"] })];
  const rare = job("rare", { kind: "Аварийные работы", equipment: "ONT" });
  const common = job("common");
  assert.ok(compareJobsForRecovery(rare, common, engineers) < 0);
});

test("activating a new engineer is penalized unless the objective is raw distance", () => {
  const item = engineer("e1");
  const next = plan(3);
  assert.equal(vehicleActivationPenalty("fieldflow"), VEHICLE_COST);
  assert.equal(vehicleActivationPenalty("distance"), 0);
  assert.equal(insertionScore(item, 0, 0, next, "fieldflow"), scoreAssignedRoute(next, item) + VEHICLE_COST);
  assert.equal(insertionScore(item, 2, 10, next, "fieldflow"), scoreAssignedRoute(next, item) - 10);
});

test("insertion pick keeps the cheapest candidate at low temperature", () => {
  const cheap = { engineer: engineer("e1"), route: [], plan: plan(1), score: 1 };
  const expensive = { engineer: engineer("e2"), route: [], plan: plan(20), score: 20 };
  const chosen = pickInsertion([expensive, cheap], () => 0, 0.01);
  assert.equal(chosen.engineer.id, "e1");
});

test("unassigned reasons distinguish cancelled, missing skill and infeasible windows", () => {
  const evalRoute = {
    simulate: (item, route) => route.every(task => task.windowEnd >= 600) ? plan(1) : null,
    travelKm: () => 1,
    travelMinutes: () => 200,
  };
  const assignments = new Map([["e1", []]]);
  assert.match(reasonJobUnassigned(job("a", { cancelled: true }), [engineer("e1")], assignments, evalRoute), /отменена/);
  assert.match(reasonJobUnassigned(job("a", { kind: "Другое" }), [engineer("e1")], assignments, evalRoute), /навыком/);
  assert.match(reasonJobUnassigned(job("a", { windowEnd: 500 }), [engineer("e1")], assignments, evalRoute), /окн/);
});
