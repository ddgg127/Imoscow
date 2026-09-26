import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import { importPlanText } from "../lib/import-data.ts";
import { cancelUnassignedJob, insertOrdinaryJob, mergeTemporalResult, prepareTemporalReplan } from "../lib/temporal-replan.ts";
import { applyAverageWindows, baselinePlan, compareReplannedPlans, fallbackTravel, optimizeVrptw, resultFromRouteOrder, transportAllowed } from "../lib/vrptw.ts";

const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };

test("source CSV windows survive import and the first plan unchanged", () => {
  const files = ["east", "southeast", "southcenter"];
  const source = files.flatMap(region => {
    const text = new TextDecoder("windows-1251").decode(readFileSync(new URL(`../data/csv/${region}-synthetic.csv`, import.meta.url)));
    const rows = text.trim().split(/\r?\n/).map(line => line.split(";"));
    const headers = rows.shift();
    const col = key => headers.indexOf(key);
    return rows.filter(row => /^\d+$/.test(row[col("Заявка")])).map(row => ({ id: row[col("Заявка")], start: row[col("Начало")], end: row[col("Окончание")] }));
  });
  assert.equal(source.length, 205);
  for (const [index, row] of source.entries()) {
    const job = csvJobs.find(item => item.sourceId === row.id || item.id === String(index + 1).padStart(4, "0"));
    assert.ok(job, row.id);
    assert.equal(job.windowStart, Number(row.start.slice(-5, -3)) * 60 + Number(row.start.slice(-2)));
    assert.equal(job.windowEnd, Number(row.end.slice(-5, -3)) * 60 + Number(row.end.slice(-2)));
  }
  assert.ok(applyAverageWindows(csvJobs, 240).some((job, index) => job.windowStart !== csvJobs[index].windowStart || job.windowEnd !== csvJobs[index].windowEnd));
  assert.ok(csvJobs.every(job => job.engineerId === null && job.baselineEngineerId === null && job.status === "Новая"));
  const firstPlan = optimizeVrptw(csvEngineers, csvJobs, { speedKmh: 24, travel: fallbackTravel(24), innerBudget: 2, zoneBudget: 2 });
  assert.deepEqual(firstPlan.jobs.map(job => [job.id, job.windowStart, job.windowEnd]), csvJobs.map(job => [job.id, job.windowStart, job.windowEnd]));
});

test("demonstration crew count is independent of control-row ordering", () => {
  assert.equal(csvEngineers.length, 35);
  assert.deepEqual(csvEngineers.map(engineer => engineer.region).reduce((counts, region) => ({ ...counts, [region]: (counts[region] ?? 0) + 1 }), {}), { "Восток": 12, "Юго-восток": 12, "Югоцентр": 11 });
  assert.ok(csvEngineers.every(engineer => engineer.name.startsWith("Инженер ") && engineer.skills.length && engineer.equipment.length));
});

test("transport is unrestricted only when the request has no explicit condition", () => {
  for (const mode of ["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"]) assert.equal(transportAllowed({ requiredTransport: "" }, mode), true);
  for (const mode of ["Автомобиль", "Общественный транспорт", "Пешком"]) assert.equal(transportAllowed({ requiredTransport: "Велосипед" }, mode), false);
  assert.equal(transportAllowed({ requiredTransport: "Велосипед" }, "Велосипед"), true);
  assert.equal(transportAllowed({ requiredTransport: "Велосипед", allowedTransports: ["Велосипед", "Пешком"] }, "Пешком"), false);
  assert.equal(transportAllowed({ requiredTransport: "", allowedTransports: ["Велосипед", "Пешком"] }, "Пешком"), true);
  const text = "Заявка;Адрес;Регион;Начало;Окончание;Тип работы;Оборудование;Транспорт;Долгота;Широта\nA;Тест;Восток;08:00;10:00;Локальные работы;Диагностический комплект;;37.78;55.71\nB;Тест;Восток;08:00;10:00;Локальные работы;Диагностический комплект;Велосипед;37.78;55.71";
  const imported = importPlanText(text, "transport.csv", centers);
  assert.equal(imported.jobs[0].requiredTransport, "");
  assert.equal(imported.jobs[0].allowedTransports, undefined);
  assert.equal(imported.jobs[1].requiredTransport, "Велосипед");
  assert.equal(imported.jobs[1].allowedTransports, undefined);
});

const engineer = { id: "e", initials: "Е", name: "Инженер", route: "R", jobs: 0, distance: "", load: 0, color: "#000", region: "Восток", start: [0, 0], skills: ["Локальные работы", "Аварийно-восстановительные работы"], equipment: ["Диагностический комплект", "Рефлектометр"], transport: "Автомобиль", shiftStart: 480, shiftEnd: 1000 };
const job = (id, x, start, end, service = 30, kind = "Локальные работы") => ({ id, time: "", windowStart: start, windowEnd: end, serviceMinutes: service, area: "", address: id, kind, tone: "blue", region: "Восток", engineerId: null, baselineEngineerId: null, coordinates: [x, 0], risk: false, equipment: kind === "Локальные работы" ? "Диагностический комплект" : "Рефлектометр", requiredTransport: "", priority: 1, source: "test", status: "Новая" });
const travel = { distanceKm: (a, b) => Math.abs(a[0] - b[0]), durationMin: (a, b) => Math.abs(a[0] - b[0]) * 5 };

test("13:10 event locks the ongoing job and rejects its cancellation", () => {
  const jobs = [job("A", 0, 480, 600, 360), job("B", 1, 850, 950)];
  const previous = resultFromRouteOrder([engineer], jobs, [{ engineerId: "e", jobIds: ["A", "B"] }], { speedKmh: 24, travel });
  const urgent = job("C", 0, 790, 900, 80, "Аварийно-восстановительные работы");
  const event = { type: "new_job", time: 790, id: "C" };
  const prepared = prepareTemporalReplan(previous, [engineer], [...jobs, urgent], [], event);
  assert.deepEqual(prepared.lockedRoutes[0].stops.map(stop => stop.jobId), ["A"]);
  assert.equal(prepared.continuationEngineers[0].shiftStart, previous.routes[0].stops[0].end);
  const suffix = resultFromRouteOrder(prepared.continuationEngineers, prepared.remainingJobs, [{ engineerId: "e", jobIds: ["C", "B"] }], { speedKmh: 24, travel });
  const merged = mergeTemporalResult(previous, suffix, prepared, [engineer], [...jobs, urgent], 24, travel);
  assert.deepEqual(merged.routes[0].stops[0], previous.routes[0].stops[0]);
  assert.throws(() => prepareTemporalReplan(previous, [engineer], [{ ...jobs[0], cancelled: true }, jobs[1]], [], { type: "cancel_job", time: 790, id: "A" }), /уже начата/);
});

test("ordinary new work inserts only without moving agreed times", () => {
  const jobs = [job("A", 0, 480, 500, 60), job("B", 1, 570, 700, 30)];
  const previous = resultFromRouteOrder([engineer], jobs, [{ engineerId: "e", jobIds: ["A", "B"] }], { speedKmh: 24, travel });
  const newJob = job("C", 0, 540, 560, 10);
  const prepared = prepareTemporalReplan(previous, [engineer], [...jobs, newJob], [], { type: "new_job", time: 540, id: "C" });
  const inserted = insertOrdinaryJob(previous, prepared, newJob, 24, travel);
  assert.equal(inserted.inserted, true);
  assert.deepEqual(inserted.orders[0].jobIds, ["C", "B"]);
  const suffix = resultFromRouteOrder(prepared.continuationEngineers, prepared.remainingJobs, inserted.orders, { speedKmh: 24, travel });
  const merged = mergeTemporalResult(previous, suffix, prepared, [engineer], [...jobs, newJob], 24, travel);
  assert.equal(merged.routes[0].stops.find(stop => stop.jobId === "B").start, previous.routes[0].stops.find(stop => stop.jobId === "B").start);
  const tooLong = job("D", 0, 540, 560, 40);
  const preparedLong = prepareTemporalReplan(previous, [engineer], [...jobs, tooLong], [], { type: "new_job", time: 540, id: "D" });
  assert.equal(insertOrdinaryJob(previous, preparedLong, tooLong, 24, travel).inserted, false);
});

test("cancellation and engineer outage preserve past work and only change future assignments", () => {
  const colleague = { ...engineer, id: "e2", name: "Коллега", start: [2, 0] };
  const jobs = [job("A", 0, 480, 600, 180), job("B", 1, 800, 900), job("C", 2, 900, 1000)];
  const previous = resultFromRouteOrder([engineer, colleague], jobs, [{ engineerId: "e", jobIds: ["A", "B", "C"] }], { speedKmh: 24, travel });
  const time = 790;
  const cancelledJobs = jobs.map(item => item.id === "B" ? { ...item, cancelled: true } : item);
  const cancelled = prepareTemporalReplan(previous, [engineer, colleague], cancelledJobs, [], { type: "cancel_job", time, id: "B" });
  assert.deepEqual([...cancelled.lockedJobIds], ["A"]);
  assert.deepEqual(cancelled.remainingJobs.map(item => item.id), ["C"]);
  const cancelledSuffix = resultFromRouteOrder(cancelled.continuationEngineers, cancelled.remainingJobs, [{ engineerId: "e", jobIds: ["C"] }], { speedKmh: 24, travel });
  const afterCancellation = mergeTemporalResult(previous, cancelledSuffix, cancelled, [engineer, colleague], cancelledJobs, 24, travel);
  assert.deepEqual(afterCancellation.routes[0].stops[0], previous.routes[0].stops[0]);
  assert.ok(compareReplannedPlans(previous, afterCancellation, [engineer, colleague], time).every(change => !change.key.endsWith("-A")));
  assert.equal(compareReplannedPlans(previous, afterCancellation, [engineer, colleague], time, { type: "cancel_job", id: "B" }).find(change => change.key === "assignment-B")?.necessity, "required");

  const outage = prepareTemporalReplan(previous, [engineer, colleague], jobs, ["e"], { type: "engineer_unavailable", time, id: "e" });
  assert.deepEqual(outage.continuationEngineers.map(item => item.id), ["e2"]);
  const outageSuffix = resultFromRouteOrder(outage.continuationEngineers, outage.remainingJobs, [{ engineerId: "e2", jobIds: ["B", "C"] }], { speedKmh: 24, travel });
  const afterOutage = mergeTemporalResult(previous, outageSuffix, outage, [engineer, colleague], jobs, 24, travel);
  assert.deepEqual(afterOutage.routes.find(route => route.engineerId === "e").stops, previous.routes[0].stops.slice(0, 1));
  assert.equal(afterOutage.jobs.find(item => item.id === "B").engineerId, "e2");
  const outageChanges = compareReplannedPlans(previous, afterOutage, [engineer, colleague], time, { type: "engineer_unavailable", id: "e" });
  assert.equal(outageChanges.find(change => change.key === "assignment-B")?.necessity, "required");
  assert.ok(outageChanges.filter(change => change.kind === "time").every(change => !change.necessity));
});

test("cancelling a doubly unassigned request is a genuine no-op for routes", () => {
  const impossible = { ...job("X", 2, 480, 900), requiredTransport: "Вертолёт" };
  const jobs = [job("A", 0, 480, 800), impossible];
  const previous = resultFromRouteOrder([engineer], jobs, [{ engineerId: "e", jobIds: ["A"] }], { speedKmh: 24, travel });
  const next = cancelUnassignedJob(previous, "X");
  assert.deepEqual(next.routes, previous.routes);
  assert.deepEqual(next.baselineRoutes, previous.baselineRoutes);
  assert.equal(next.metrics.total, previous.metrics.total - 1);
  assert.equal(next.baseline.total, previous.baseline.total - 1);
  assert.equal(next.metrics.assigned, previous.metrics.assigned);
  assert.equal(next.jobs.find(item => item.id === "X").cancelled, true);
  assert.deepEqual(compareReplannedPlans(previous, next, [engineer], 790), []);
});

test("saved 12/51 reference case has a visible baseline conflict and one resource blocker", () => {
  const demo = JSON.parse(readFileSync(new URL("../data/demo-scenario.json", import.meta.url), "utf8"));
  const imported = importPlanText(JSON.stringify(demo), "demo-scenario.json", centers);
  assert.ok(imported.engineers.every(item => item.speedKmh == null));
  assert.equal(demo.engineers.length, 12);
  assert.equal(demo.jobs.length, 51);
  assert.deepEqual(new Set(demo.engineers.map(engineer => engineer.transport)), new Set(["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"]));
  const road = fallbackTravel(24);
  const baseline = baselinePlan(demo.engineers, demo.jobs, 24, road);
  const optimized = optimizeVrptw(demo.engineers, demo.jobs, { speedKmh: 24, travel: road, innerBudget: 80, zoneBudget: 200 });
  assert.equal(baseline.metrics.assigned, 47);
  assert.equal(optimized.metrics.assigned, 50);
  assert.deepEqual(optimized.jobs.filter(item => !item.engineerId).map(item => item.id), ["D-NO-TRANSPORT"]);
  assert.match(optimized.jobs.find(item => item.id === "D-NO-TRANSPORT").unassignedReason, /транспорт/);
});
