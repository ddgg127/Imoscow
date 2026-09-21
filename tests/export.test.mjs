import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanExport, serializePlanCsv, serializePlanJson } from "../lib/export-plan.ts";
import { optimizeVrptw } from "../lib/vrptw.ts";

const engineer = { id: "e1", name: "Инженер", initials: "ИИ", region: "Восток", route: "R", jobs: 0, distance: "0", load: 0, color: "#000", start: [0, 0], skills: ["Монтаж"], equipment: ["ONT"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 720 };
const job = { id: "a", time: "08:00–10:00", windowStart: 480, windowEnd: 600, area: "ВАО", address: "=1+1", kind: "Монтаж", tone: "blue", region: "Восток", engineerId: null, baselineEngineerId: null, coordinates: [1, 0], risk: false, equipment: "ONT", requiredTransport: "Автомобиль", priority: 1, serviceMinutes: 30, source: "Тест", status: "Новая" };
const travel = { distanceKm: (a, b) => Math.abs(a[0] - b[0]), durationMin: (a, b) => Math.abs(a[0] - b[0]) * 5 };
const result = optimizeVrptw([engineer], [job], { travel, innerBudget: 1, zoneBudget: 1 });

test("CSV export has stable columns, route facts and formula protection", () => {
  const csv = serializePlanCsv(result, [engineer]);
  assert.match(csv, /^Заявка;Статус;Регион;/);
  assert.match(csv, /'\=1\+1/);
  assert.match(csv, /a;Назначена;Восток/);
  assert.equal(csv.split("\r\n").length, 2);
});

test("JSON export contains version, solver, metrics and complete stops", () => {
  const metadata = { solver: "ortools", generatedAt: "2026-09-19T00:00:00.000Z", speedKmh: 24 };
  const value = buildPlanExport(result, [engineer], metadata);
  assert.equal(value.schemaVersion, "1.0");
  assert.equal(value.solver, "ortools");
  assert.equal(value.routes[0].stops[0].job.id, "a");
  assert.deepEqual(JSON.parse(serializePlanJson(result, [engineer], metadata)).metrics, result.metrics);
});
