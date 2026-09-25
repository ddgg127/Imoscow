import assert from "node:assert/strict";
import test from "node:test";
import { csvEngineers, csvJobs } from "../lib/csv-data.generated.ts";
import { generateDataset, generatedCsv, generatedJson } from "../lib/generator-files.ts";
import { importPlanText } from "../lib/import-data.ts";
import { fallbackTravel, optimizeVrptw } from "../lib/vrptw.ts";

const centers = { "Восток": [37.78, 55.71], "Юго-восток": [37.67, 55.59], "Югоцентр": [37.61, 55.65] };
const sample = generateDataset(csvJobs.slice(0, 12), csvEngineers.slice(0, 8), { jobs: 15, engineers: 10, windowMinutes: 180, speedKmh: 31 });

function verifyRoundTrip(fileName, text) {
  const imported = importPlanText(text, fileName, centers);
  assert.equal(imported.jobs.length, sample.jobs.length);
  assert.equal(imported.engineers.length, sample.engineers.length);
  assert.equal(imported.speedKmh, 31);
  for (let index = 0; index < sample.jobs.length; index++) {
    const actual = imported.jobs[index];
    const expected = sample.jobs[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.coordinates, expected.coordinates);
    assert.equal(actual.geocodeQuality, expected.geocodeQuality);
    assert.equal(actual.windowStart, expected.windowStart);
    assert.equal(actual.windowEnd, expected.windowEnd);
    assert.equal(actual.serviceMinutes, expected.serviceMinutes);
    assert.equal(actual.equipment, expected.equipment);
    assert.equal(actual.requiredTransport, expected.requiredTransport);
    assert.deepEqual(actual.allowedTransports, expected.allowedTransports);
  }
  for (let index = 0; index < sample.engineers.length; index++) {
    const actual = imported.engineers[index];
    const expected = sample.engineers[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.start, expected.start);
    assert.deepEqual(actual.skills, expected.skills);
    assert.deepEqual(actual.equipment, expected.equipment);
    assert.equal(actual.transport, expected.transport);
    assert.equal(actual.shiftStart, expected.shiftStart);
    assert.equal(actual.shiftEnd, expected.shiftEnd);
    assert.equal(actual.startAddress, expected.startAddress ?? "");
    assert.equal(actual.startMode, expected.startMode);
    assert.equal(actual.equipmentIssue, expected.equipmentIssue);
  }
  assert.ok(imported.jobs.every(job => job.geocodeVerified), "Generated coordinates remain usable for routing");
  const result = optimizeVrptw(imported.engineers, imported.jobs, { speedKmh: imported.speedKmh, travel: fallbackTravel(imported.speedKmh), zoneBudget: 80 });
  assert.equal(result.metrics.total, sample.jobs.length);
  return imported;
}

test("generator JSON is importable and routable without losing planning fields", () => {
  verifyRoundTrip("generated.json", generatedJson(sample));
});

test("generator CSV is importable and routable without losing planning fields", () => {
  verifyRoundTrip("generated.csv", generatedCsv(sample));
});

test("average window is a mean, not a uniform duration", () => {
  for (const average of [60, 240, 480]) {
    for (const count of [1, 2, 25, 250, 300, 350]) {
      const dataset = generateDataset(csvJobs, csvEngineers, { jobs: count, engineers: 25, windowMinutes: average, speedKmh: 24 });
      const widths = dataset.jobs.map(job => job.windowEnd - job.windowStart);
      assert.equal(widths.reduce((sum, width) => sum + width, 0) / count, average);
      assert.ok(dataset.jobs.every(job => job.windowStart >= 480 && job.windowEnd <= 1320));
      if (count > 1) assert.ok(new Set(widths).size > 1);
    }
  }
});

test("small engineer pools cover all regions and generated work stays distributed", () => {
  for (const count of [250, 300, 350]) {
    const dataset = generateDataset(csvJobs, csvEngineers, { jobs: count, engineers: 25, windowMinutes: 240, speedKmh: 24 });
    const regions = new Set(csvJobs.map(job => job.region));
    assert.deepEqual(new Set(dataset.engineers.map(engineer => engineer.region)), regions);
    const added = dataset.jobs.slice(csvJobs.length);
    assert.ok(regions.size === 3 && [...regions].every(region => added.some(job => job.region === region)));
    assert.equal(new Set(dataset.jobs.map(job => job.id)).size, count);
  }
});

test("large generated CSV and JSON keep variable windows and the selected team", () => {
  const dataset = generateDataset(csvJobs, csvEngineers, { jobs: 300, engineers: 25, windowMinutes: 240, speedKmh: 24 });
  for (const [file, text] of [["generated.csv", generatedCsv(dataset)], ["generated.json", generatedJson(dataset)]]) {
    const imported = importPlanText(text, file, centers);
    assert.equal(imported.jobs.length, 300);
    assert.equal(imported.engineers.length, 25);
    assert.deepEqual(imported.jobs.map(job => [job.id, job.windowStart, job.windowEnd]), dataset.jobs.map(job => [job.id, job.windowStart, job.windowEnd]));
    assert.deepEqual(imported.engineers.map(engineer => engineer.id), dataset.engineers.map(engineer => engineer.id));
  }
});

test("priority checkbox produces a reproducible urgent minority in both upload formats", () => {
  const ordinary = generateDataset(csvJobs, csvEngineers, { jobs: 70, engineers: 15, windowMinutes: 240, speedKmh: 24, highPriority: false });
  const mixed = generateDataset(csvJobs, csvEngineers, { jobs: 70, engineers: 15, windowMinutes: 240, speedKmh: 24, highPriority: true });
  assert.equal(ordinary.jobs.filter(job => job.urgency === "urgent").length, 0);
  assert.equal(mixed.jobs.filter(job => job.urgency === "urgent").length, 10);
  assert.ok(mixed.jobs.filter(job => job.urgency === "urgent").every(job => job.priority >= 10));
  for (const [file, text] of [["urgent.csv", generatedCsv(mixed)], ["urgent.json", generatedJson(mixed)]]) {
    const imported = importPlanText(text, file, centers);
    assert.equal(imported.jobs.filter(job => job.urgency === "urgent").length, 10);
  }
});
