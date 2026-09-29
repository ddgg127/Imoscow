import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanExport, serializePlanCsv, serializePlanJson } from "../lib/export-plan.ts";
import { importPlanText } from "../lib/import-data.ts";
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

test("downloaded plan JSON and CSV can be loaded as a new dataset", () => {
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const crew = { ...engineer, skills: ["Локальные работы"], equipment: ["Диагностический комплект"], start: [37.7, 55.7] };
  const work = { ...job, address: "Москва, Тестовая улица, 1", kind: "Локальные работы", workType: "Диагностика", equipment: "Диагностический комплект", coordinates: [37.71, 55.7], geocodeVerified: true, geocodeQuality: "house", allowedTransports: ["Автомобиль"], area: "Восток" };
  const plan = optimizeVrptw([crew], [work], { travel, innerBudget: 1, zoneBudget: 1 });
  const metadata = { solver: "ortools", speedKmh: 24 };
  const json = importPlanText(serializePlanJson(plan, [crew], metadata), "fieldflow-plan.json", centers);
  assert.equal(json.jobs.length, 1);
  assert.equal(json.engineers.length, 1);
  assert.equal(json.jobs[0].id, work.id);
  assert.deepEqual(json.jobs[0].coordinates, work.coordinates);
  assert.equal(json.speedKmh, 24);
  const csv = importPlanText(serializePlanCsv(plan, [crew]), "fieldflow-plan.csv", centers);
  assert.equal(csv.jobs.length, 1);
  assert.equal(csv.engineers, undefined);
  assert.deepEqual(csv.jobs[0].coordinates, work.coordinates);
  assert.equal(csv.jobs[0].windowEnd, work.windowEnd);
  assert.equal(csv.jobs[0].serviceMinutes, work.serviceMinutes);
  assert.equal(csv.jobs[0].kind, work.kind);
  assert.deepEqual(csv.jobs[0].allowedTransports, work.allowedTransports);
  assert.match(csv.warnings.join(" "), /инженеров/);
});

test("older plan exports remain importable", () => {
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const crew = { ...engineer, skills: ["Локальные работы"], equipment: ["Диагностический комплект"], start: [37.7, 55.7] };
  const work = { ...job, address: "Москва, Тестовая улица, 1", kind: "Локальные работы", equipment: "Диагностический комплект", coordinates: [37.71, 55.7], geocodeVerified: true };
  const plan = optimizeVrptw([crew], [work], { travel, innerBudget: 1, zoneBudget: 1 });
  const old = buildPlanExport(plan, [crew], { solver: "ortools", speedKmh: 24 });
  delete old.jobs;
  delete old.engineers;
  const imported = importPlanText(JSON.stringify(old), "old-plan.json", centers);
  assert.equal(imported.jobs.length, 1);
  assert.equal(imported.engineers.length, 1);
  assert.equal(imported.speedKmh, 24);
  const oldCsv = serializePlanCsv(plan, [crew]).split("\r\n").map(line => line.split(";").slice(0, 26).join(";")).join("\r\n");
  const importedCsv = importPlanText(oldCsv, "old-plan.csv", centers);
  assert.equal(importedCsv.jobs.length, 1);
  assert.equal(importedCsv.jobs[0].windowStart, work.windowStart);
  assert.equal(importedCsv.jobs[0].windowEnd, work.windowEnd);
  assert.equal(importedCsv.jobs[0].geocodeVerified, false);
});
