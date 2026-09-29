import test from "node:test";
import assert from "node:assert/strict";
import { explainPlanComparison } from "../lib/optimization-explanation.ts";
import { explainAssignment, resultFromRouteOrder } from "../lib/vrptw.ts";

test("higher mileage with unchanged fleet reports coverage instead of inventing consolidation", () => {
  const text = explainPlanComparison(50, 34, 9, 9, 9.6, false);
  assert.match(text, /50 заявок против 34/);
  assert.match(text, /9 инженеров против 9/);
  assert.match(text, /Наборы обслуживаемых заявок различаются/);
  assert.doesNotMatch(text, /уплотнение|штраф|машин/);
});

test("comparison distinguishes equal counts from equal served sets", () => {
  assert.match(explainPlanComparison(2, 2, 1, 1, -10, false), /Наборы .* различаются/);
  assert.match(explainPlanComparison(2, 2, 1, 2, 0, true), /один и тот же набор/);
  assert.match(explainPlanComparison(2, 2, 1, 2, 0, true), /почти не изменился/);
});

test("a cheaper feasible alternative is not claimed to worsen the global plan", () => {
  const engineers = [0, 9].map((x, i) => ({ id: `e${i}`, region: "Восток", transport: "Автомобиль", equipment: ["ONT"], skills: ["Монтаж"], start: [x, 0], shiftStart: 480, shiftEnd: 900 }));
  const jobs = [{ id: "a", region: "Восток", equipment: "ONT", kind: "Монтаж", coordinates: [10, 0], windowStart: 480, windowEnd: 650, serviceMinutes: 30, priority: 1 }];
  const travel = { distanceKm: (a, b) => Math.abs(a[0] - b[0]), durationMin: (a, b) => Math.abs(a[0] - b[0]) };
  const result = resultFromRouteOrder(engineers, jobs, [{ engineerId: "e0", jobIds: ["a"] }], { travel });
  const text = explainAssignment(result.jobs[0], engineers[0], result.routes[0], engineers, result.routes, result.jobs, 32, travel);
  assert.equal(text.alternatives[0].feasible, true);
  assert.match(text.alternatives[0].reason, /преимущество для всего плана не проверено/);
  assert.doesNotMatch(text.alternatives[0].reason, /глобально ухудшается/);
});

test("window explanation constrains start, not completion", () => {
  const engineer = { id: "e", region: "Восток", transport: "Автомобиль", equipment: ["ONT"], skills: ["Монтаж"], start: [0, 0], shiftStart: 480, shiftEnd: 900 };
  const job = { id: "a", region: "Восток", equipment: "ONT", kind: "Монтаж", coordinates: [0, 0], windowStart: 480, windowEnd: 490, serviceMinutes: 60, priority: 1 };
  const travel = { distanceKm: () => 0, durationMin: () => 0 };
  const result = resultFromRouteOrder([engineer], [job], [{ engineerId: "e", jobIds: ["a"] }], { travel });
  const text = explainAssignment(result.jobs[0], engineer, result.routes[0], [engineer], result.routes, result.jobs, 32, travel);
  assert.match(text.checks.join(" "), /Начало 08:00 попадает в окно SLA 08:00–08:10/);
  assert.match(text.checks.join(" "), /работа заканчивается в 09:00, до конца смены 15:00/);
});
