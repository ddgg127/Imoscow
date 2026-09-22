import assert from "node:assert/strict";
import test from "node:test";
import { csvEngineers, csvJobs, csvMeta } from "../lib/csv-data.generated.ts";
import { importPlanFile } from "../lib/import-data.ts";
import { fallbackTravel, optimizeVrptw } from "../lib/vrptw.ts";

test("all built-in addresses are verified and quality is explicit", () => {
  assert.equal(csvMeta.geocoding.uniqueAddresses, 198);
  assert.equal(csvMeta.geocoding.verifiedAddresses, 198);
  assert.equal(csvMeta.geocoding.fallbackAddresses, 0);
  assert.ok(csvJobs.every(job => job.geocodeVerified && ["house", "street"].includes(job.geocodeQuality)));
});

test("skills, transport and service norms use controlled domain dictionaries", () => {
  const skillCatalog = new Set(["Локальные работы", "Подключение и модернизация", "Аварийно-восстановительные работы"]);
  assert.ok(csvJobs.every(job => skillCatalog.has(job.kind)));
  assert.ok(csvEngineers.every(engineer => engineer.skills.every(skill => skillCatalog.has(skill))));
  assert.deepEqual(new Set(csvEngineers.map(engineer => engineer.transport)), new Set(["Автомобиль", "Общественный транспорт", "Велосипед", "Пешком"]));
  assert.ok(new Set(csvJobs.map(job => job.serviceMinutes)).size >= 2);
  assert.ok(csvJobs.every(job => job.serviceMinutes >= 30 && job.serviceMinutes <= 120));
});

test("cancelled jobs are never assigned", () => {
  const jobs = csvJobs.slice(0, 12).map((job, index) => ({ ...job, cancelled: index === 0 }));
  const result = optimizeVrptw(csvEngineers, jobs, { speedKmh: 24, travel: fallbackTravel(24), zoneBudget: 80 });
  const cancelled = result.jobs[0];
  assert.equal(cancelled.engineerId, null);
  assert.match(cancelled.unassignedReason, /отменена/i);
});

test("CSV upload accepts Russian headers and explicit coordinates", async () => {
  const text = "Заявка;Адрес;Регион;Начало;Окончание;Тип работы;Оборудование;Транспорт;Норматив;Долгота;Широта\nIMP-1;Москва, Арбат, 10;Югоцентр;09:00;11:00;Локальные работы;Диагностический комплект;Пешком;30;37.59;55.75\n";
  const file = new File([text], "jobs.csv", { type: "text/csv" });
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const result = await importPlanFile(file, centers);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].id, "IMP-1");
  assert.equal(result.jobs[0].geocodeVerified, true);
  assert.deepEqual(result.jobs[0].coordinates, [37.59, 55.75]);
});

test("generator dataset JSON maps into planner jobs and engineers", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../generator/datasets/sample/dataset.json", import.meta.url), "utf8");
  const file = new File([text], "dataset.json", { type: "application/json" });
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const result = await importPlanFile(file, centers);
  assert.equal(result.jobs.length, 11);
  assert.equal(result.engineers?.length, 7);
  assert.ok(result.jobs.every(job => job.geocodeVerified && job.serviceMinutes >= 5));
  assert.ok(result.engineers?.every(engineer => engineer.transport !== "Пешеход" && engineer.skills.length >= 1));
  assert.equal(result.jobs.find(job => job.id === "J001")?.windowStart, 15 * 60 + 25);
});

test("generator jobs CSV skips Excel sep= header", async () => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(new URL("../generator/datasets/sample/jobs.csv", import.meta.url));
  const file = new File([bytes], "jobs.csv", { type: "text/csv" });
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const result = await importPlanFile(file, centers);
  assert.equal(result.jobs[0].id, "J001");
  assert.equal(result.jobs.length, 11);
});

test("generator engineers CSV can be imported separately", async () => {
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(new URL("../generator/datasets/sample/engineers.csv", import.meta.url));
  const file = new File([bytes], "engineers.csv", { type: "text/csv" });
  const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
  const result = await importPlanFile(file, centers);
  assert.equal(result.jobs.length, 0);
  assert.equal(result.engineers?.length, 7);
  assert.ok(result.engineers?.every(engineer => engineer.skills.length && engineer.shiftEnd > engineer.shiftStart));
});
